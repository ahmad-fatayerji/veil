use std::{
    collections::HashSet,
    net::Ipv4Addr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tokio::{
    sync::{broadcast, watch},
    time::{timeout, Instant},
};
use tower_http::cors::CorsLayer;
use yrs::{
    encoding::read::Cursor,
    sync::{Awareness, DefaultProtocol, Message, Protocol, SyncMessage},
    updates::{
        decoder::{Decode, Decoder, DecoderV1},
        encoder::Encode,
    },
    ClientID, Doc, ReadTxn, Transact,
};

const ORIGINS: [&str; 4] = [
    "http://127.0.0.1:5173",
    "http://127.0.0.1:1420",
    "http://tauri.localhost",
    "tauri://localhost",
];
const MAX_FRAME: usize = 256 * 1024;
const SEND_TIMEOUT: Duration = Duration::from_secs(5);

struct Room {
    awareness: Mutex<Awareness>,
    awareness_owners: Mutex<HashSet<ClientID>>,
    updates: broadcast::Sender<Vec<u8>>,
    token: String,
    session_id: String,
    hosts: Vec<String>,
    origins: Vec<String>,
    stopping: watch::Sender<bool>,
    joins: Mutex<(Instant, u32)>,
}

impl Room {
    fn new() -> Arc<Self> {
        let (updates, _) = broadcast::channel(128);
        Arc::new(Self {
            awareness: Mutex::new(Awareness::new(Doc::new())),
            awareness_owners: Mutex::new(HashSet::new()),
            updates,
            session_id: uuid::Uuid::new_v4().simple().to_string(),
            hosts: vec!["127.0.0.1:4444".into()],
            origins: ORIGINS.iter().map(|s| (*s).into()).collect(),
            stopping: watch::channel(false).0,
            joins: Mutex::new((Instant::now(), 0)),
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        })
    }
}

fn trusted_request(room: &Room, headers: &HeaderMap) -> bool {
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    host.is_some_and(|value| room.hosts.iter().any(|h| h == value))
        && origin.is_some_and(|value| room.origins.iter().any(|o| o == value))
}

async fn bootstrap(State(room): State<Arc<Room>>, headers: HeaderMap) -> Response {
    if !trusted_request(&room, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({ "protocolVersion": 1, "token": room.token, "participantLimit": null })),
    ).into_response()
}

async fn upgrade(
    State(room): State<Arc<Room>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !trusted_request(&room, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let requested: HashSet<&str> = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .collect();
    let credential = format!("veil.auth.{}", room.token);
    if !requested.contains("veil.v1") || !requested.contains(credential.as_str()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.protocols(["veil.v1"])
        .max_message_size(MAX_FRAME)
        .max_frame_size(MAX_FRAME)
        .on_upgrade(move |socket| connected(socket, room))
}

fn router(room: Arc<Room>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(ORIGINS.map(HeaderValue::from_static).to_vec())
        .allow_methods([Method::GET]);
    Router::new()
        .route("/health", get(|| async { "veil-m0" }))
        .route("/bootstrap", get(bootstrap))
        .route("/ws/m0-demo", get(upgrade))
        .with_state(room)
        .layer(cors)
}

async fn send(socket: &mut WebSocket, data: Vec<u8>) -> bool {
    matches!(
        timeout(SEND_TIMEOUT, socket.send(WsMessage::Binary(data.into()))).await,
        Ok(Ok(()))
    )
}

// Decode one complete y-sync message per frame, matching y-websocket 3's framing.
fn apply(room: &Room, data: &[u8], owned: &mut HashSet<ClientID>) -> Result<Vec<Vec<u8>>, ()> {
    let mut decoder = DecoderV1::new(Cursor::new(data));
    let messages = [Message::decode(&mut decoder).map_err(|_| ())?];
    if !decoder.read_to_end().map_err(|_| ())?.is_empty() {
        return Err(());
    }
    let mut awareness = room.awareness.lock().map_err(|_| ())?;
    let mut responses = Vec::new();
    for mut message in messages {
        let broadcast = matches!(
            message,
            Message::Sync(SyncMessage::SyncStep2(_) | SyncMessage::Update(_))
                | Message::Awareness(_)
        );
        if let Message::Awareness(update) = &mut message {
            let mut owners = room.awareness_owners.lock().map_err(|_| ())?;
            // y-websocket echoes remote awareness. A connection only owns IDs it first claims.
            update.clients.retain(|id, entry| {
                if owned.contains(id) {
                    return true;
                }
                if owned.is_empty() && entry.json.as_ref() != "null" && owners.insert(*id) {
                    owned.insert(*id);
                    true
                } else {
                    false
                }
            });
        }
        if matches!(message, Message::Custom(_, _) | Message::Auth(_)) {
            return Err(());
        }
        let encoded = message.encode_v1();
        if let Some(response) = DefaultProtocol
            .handle_message(&mut awareness, message)
            .map_err(|_| ())?
        {
            responses.push(response.encode_v1());
        }
        if broadcast {
            let _ = room.updates.send(encoded);
        }
    }
    Ok(responses)
}

async fn connected(mut socket: WebSocket, room: Arc<Room>) {
    let mut stopping = room.stopping.subscribe();
    if *stopping.borrow() {
        return;
    }
    // Subscribe before taking the initial state, so intervening updates cannot be missed.
    let mut updates = room.updates.subscribe();
    let initial = {
        let awareness = room.awareness.lock().expect("room lock poisoned");
        // y-websocket 3 reads one protocol message per WebSocket frame.
        awareness.update().map(|update| {
            vec![
                Message::Sync(SyncMessage::SyncStep1(
                    awareness.doc().transact().state_vector(),
                ))
                .encode_v1(),
                Message::Awareness(update).encode_v1(),
            ]
        })
    };
    let Ok(initial) = initial else {
        return;
    };
    for frame in initial {
        if !send(&mut socket, frame).await {
            return;
        }
    }
    let mut owned = HashSet::new();
    let mut window = Instant::now();
    let mut frames = 0;
    loop {
        tokio::select! {
            _ = stopping.changed() => break,
            incoming = socket.recv() => {
                if window.elapsed() >= Duration::from_secs(1) { window = Instant::now(); frames = 0; }
                frames += 1;
                if frames > 200 { break; }
                match incoming {
                    Some(Ok(WsMessage::Binary(data))) => {
                        let Ok(responses) = apply(&room, &data, &mut owned) else { break; };
                        let mut ok = true;
                        for response in responses { if !send(&mut socket, response).await { ok = false; break; } }
                        if !ok { break; }
                    }
                    Some(Ok(WsMessage::Ping(data))) => {
                        if !matches!(timeout(SEND_TIMEOUT, socket.send(WsMessage::Pong(data))).await, Ok(Ok(()))) { break; }
                    }
                    Some(Ok(WsMessage::Pong(_))) => {},
                    _ => break,
                }
            }
            update = updates.recv() => {
                // A lagged subscriber is disconnected and must resync; never drop CRDT updates silently.
                let Ok(update) = update else { break; };
                if !send(&mut socket, update).await { break; }
            }
        }
    }
    {
        let mut awareness = room.awareness.lock().expect("room lock poisoned");
        let mut owners = room.awareness_owners.lock().expect("owner lock poisoned");
        for id in &owned {
            owners.remove(id);
        }
        if let Ok(mut update) = awareness.update_with_clients(owned) {
            // Preserve clocks like y-protocols removeAwarenessStates. Yrs remove_state
            // increments them, which would suppress a reconnecting client's unchanged state.
            for entry in update.clients.values_mut() {
                entry.json = "null".into();
            }
            let encoded = Message::Awareness(update.clone()).encode_v1();
            let _ = awareness.apply_update(update);
            let _ = room.updates.send(encoded);
        }
    }
    let _ = timeout(SEND_TIMEOUT, socket.send(WsMessage::Close(None))).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[tokio::test]
    async fn bootstrap_requires_exact_origin_and_host() {
        for (origin, host, expected) in [
            ("http://127.0.0.1:5173", "127.0.0.1:4444", StatusCode::OK),
            (
                "https://evil.example",
                "127.0.0.1:4444",
                StatusCode::FORBIDDEN,
            ),
            (
                "http://127.0.0.1:5173",
                "evil.example:4444",
                StatusCode::FORBIDDEN,
            ),
        ] {
            let request = Request::builder()
                .uri("/bootstrap")
                .header("origin", origin)
                .header("host", host)
                .body(Body::empty())
                .unwrap();
            let response = router(Room::new()).oneshot(request).await.unwrap();
            assert_eq!(response.status(), expected);
        }
    }

    #[test]
    fn rejects_malformed_and_custom_messages() {
        let room = Room::new();
        assert!(apply(&room, &[255], &mut HashSet::new()).is_err());
        assert!(apply(
            &room,
            &Message::Custom(42, vec![]).encode_v1(),
            &mut HashSet::new()
        )
        .is_err());
    }
}

pub fn demo_router() -> Router {
    router(Room::new())
}

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostConfig {
    pub lan_address: Option<Ipv4Addr>,
    pub port: u16,
    pub acknowledge_lan: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub session_id: String,
    pub token: String,
    pub local_url: String,
    pub browser_url: String,
    pub invitation: String,
    pub exposure: &'static str,
    pub participant_limit: Option<usize>,
}

pub struct HostedSession {
    pub info: HostInfo,
    room: Arc<Room>,
    tasks: Vec<tokio::task::JoinHandle<std::io::Result<()>>>,
}

impl Drop for HostedSession {
    fn drop(&mut self) {
        let _ = self.room.stopping.send(true);
    }
}

impl HostedSession {
    pub async fn stop(mut self) -> Result<(), String> {
        let _ = self.room.stopping.send(true);
        for mut task in self.tasks.drain(..) {
            match timeout(Duration::from_secs(6), &mut task).await {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(error))) => return Err(error.to_string()),
                Ok(Err(error)) => return Err(error.to_string()),
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                    return Err("Host shutdown timed out.".into());
                }
            }
        }
        Ok(())
    }
}

pub async fn start_host(config: HostConfig) -> Result<HostedSession, String> {
    if let Some(ip) = config.lan_address {
        if !ip.is_private() || !config.acknowledge_lan {
            return Err(
                "LAN hosting requires a private IPv4 address and trusted-network acknowledgement."
                    .into(),
            );
        }
    }
    if !ASSETS.iter().any(|(name, _)| *name == "index.html") {
        return Err("Browser assets are missing. Run pnpm build before compiling the host.".into());
    }
    let local = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, config.port))
        .await
        .map_err(|e| format!("Cannot start local listener: {e}"))?;
    let port = local.local_addr().map_err(|e| e.to_string())?.port();
    let mut listeners = vec![local];
    if let Some(ip) = config.lan_address {
        listeners.push(
            tokio::net::TcpListener::bind((ip, port))
                .await
                .map_err(|e| format!("Cannot bind the selected LAN address: {e}"))?,
        );
    }
    let mut room = Room::new();
    let state = Arc::get_mut(&mut room).unwrap();
    state.hosts = listeners
        .iter()
        .map(|l| l.local_addr().unwrap().to_string())
        .collect();
    state.origins = ORIGINS
        .iter()
        .map(|s| (*s).into())
        .chain(state.hosts.iter().map(|h| format!("http://{h}")))
        .collect();
    let local_url = format!("http://127.0.0.1:{port}");
    let browser_url = config
        .lan_address
        .map(|ip| format!("http://{ip}:{port}"))
        .unwrap_or_else(|| local_url.clone());
    let info = HostInfo {
        session_id: room.session_id.clone(),
        token: room.token.clone(),
        local_url,
        invitation: format!(
            "{browser_url}/#session={}&invite={}",
            room.session_id, room.token
        ),
        browser_url,
        exposure: if config.lan_address.is_some() {
            "lan"
        } else {
            "loopback"
        },
        participant_limit: None,
    };
    let tasks = listeners
        .into_iter()
        .map(|listener| {
            let mut stopping = room.stopping.subscribe();
            let app = session_router(room.clone());
            tokio::spawn(async move {
                axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        if !*stopping.borrow() {
                            let _ = stopping.changed().await;
                        }
                    })
                    .await
            })
        })
        .collect();
    Ok(HostedSession { info, room, tasks })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JoinRequest {
    session_id: String,
    token: String,
}

async fn join_session(
    State(room): State<Arc<Room>>,
    headers: HeaderMap,
    Json(request): Json<JoinRequest>,
) -> Response {
    if !trusted_request(&room, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    {
        let mut attempts = room.joins.lock().unwrap();
        if attempts.0.elapsed() >= Duration::from_secs(1) {
            *attempts = (Instant::now(), 0);
        }
        attempts.1 += 1;
        if attempts.1 > 30 {
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        }
    }
    if request.session_id != room.session_id || request.token != room.token {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ([(header::CACHE_CONTROL, "no-store")], Json(serde_json::json!({"protocolVersion": 1, "token": room.token, "participantLimit": null}))).into_response()
}

async fn session_upgrade(
    State(room): State<Arc<Room>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if id != room.session_id {
        return StatusCode::NOT_FOUND.into_response();
    }
    upgrade(State(room), headers, ws).await
}

async fn serve_asset(uri: axum::http::Uri) -> Response {
    let name = uri.path().trim_start_matches('/');
    let name = if name.is_empty() { "index.html" } else { name };
    let Some((_, bytes)) = ASSETS.iter().find(|(path, _)| *path == name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = match name.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };
    ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "no-store"), (header::X_CONTENT_TYPE_OPTIONS, "nosniff"), (header::REFERRER_POLICY, "no-referrer"), (header::CONTENT_SECURITY_POLICY, "default-src 'self'; connect-src 'self' ws:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")], *bytes).into_response()
}

async fn check_host(
    State(room): State<Arc<Room>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    if !request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| room.hosts.iter().any(|allowed| allowed == h))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}

fn session_router(room: Arc<Room>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            room.origins
                .iter()
                .map(|s| s.parse::<HeaderValue>().unwrap())
                .collect::<Vec<_>>(),
        )
        .allow_methods([Method::POST])
        .allow_headers([header::CONTENT_TYPE]);
    Router::new()
        .route("/health", get(|| async { "veil-m2" }))
        .route("/join", post(join_session))
        .route("/ws/{id}", get(session_upgrade))
        .fallback(get(serve_asset))
        .layer(axum::extract::DefaultBodyLimit::max(4096))
        .layer(cors)
        .layer(axum::middleware::from_fn_with_state(
            room.clone(),
            check_host,
        ))
        .with_state(room)
}

#[cfg(test)]
mod session_tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn join_request(room: &Room, token: &str, origin: &str, id: &str) -> Request<Body> {
        Request::builder()
            .method(Method::POST)
            .uri("/join")
            .header(header::HOST, &room.hosts[0])
            .header(header::ORIGIN, origin)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({"sessionId": id, "token": token}).to_string(),
            ))
            .unwrap()
    }

    #[tokio::test]
    async fn invitations_authenticate_and_never_bootstrap_public_credentials() {
        let room = Room::new();
        for (token, origin, id, expected) in [
            (
                room.token.as_str(),
                ORIGINS[0],
                room.session_id.as_str(),
                StatusCode::OK,
            ),
            (
                "invalid",
                ORIGINS[0],
                room.session_id.as_str(),
                StatusCode::UNAUTHORIZED,
            ),
            (
                room.token.as_str(),
                "https://evil.example",
                room.session_id.as_str(),
                StatusCode::FORBIDDEN,
            ),
            (
                room.token.as_str(),
                ORIGINS[0],
                "wrong-session",
                StatusCode::UNAUTHORIZED,
            ),
        ] {
            let response = session_router(room.clone())
                .oneshot(join_request(&room, token, origin, id))
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
            if expected == StatusCode::OK {
                let body: serde_json::Value =
                    serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap())
                        .unwrap();
                assert!(body["participantLimit"].is_null());
            }
        }
        let response = session_router(room.clone())
            .oneshot(
                Request::builder()
                    .uri("/bootstrap")
                    .header(header::HOST, &room.hosts[0])
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn serves_only_bundled_assets_with_safe_headers_and_host_check() {
        let room = Room::new();
        for (path, host, expected) in [
            ("/", "127.0.0.1:4444", StatusCode::OK),
            ("/", "evil.example", StatusCode::FORBIDDEN),
            ("/../Cargo.toml", "127.0.0.1:4444", StatusCode::NOT_FOUND),
        ] {
            let response = session_router(room.clone())
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header(header::HOST, host)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
            if expected == StatusCode::OK {
                assert_eq!(response.headers()[header::REFERRER_POLICY], "no-referrer");
                let body = to_bytes(response.into_body(), 4096).await.unwrap();
                assert!(!String::from_utf8_lossy(&body).contains(&room.token));
            }
        }
    }

    #[tokio::test]
    async fn rejects_unacknowledged_wildcard_and_public_listeners() {
        for (ip, acknowledge_lan) in [
            ("0.0.0.0", true),
            ("8.8.8.8", true),
            ("192.168.1.20", false),
            ("127.0.0.1", true),
        ] {
            assert!(start_host(HostConfig {
                lan_address: Some(ip.parse().unwrap()),
                port: 0,
                acknowledge_lan
            })
            .await
            .is_err());
        }
    }

    #[tokio::test]
    async fn stop_releases_port_and_restart_rotates_invitation() {
        let session = start_host(HostConfig {
            lan_address: None,
            port: 0,
            acknowledge_lan: false,
        })
        .await
        .unwrap();
        let info = session.info.clone();
        let address: std::net::SocketAddr = info
            .local_url
            .trim_start_matches("http://")
            .parse()
            .unwrap();
        assert_eq!(info.exposure, "loopback");
        assert_eq!(info.participant_limit, None);
        assert!(tokio::net::TcpStream::connect(address).await.is_ok());
        session.stop().await.unwrap();
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
        let restarted = start_host(HostConfig {
            lan_address: None,
            port: address.port(),
            acknowledge_lan: false,
        })
        .await
        .unwrap();
        assert_ne!(restarted.info.session_id, info.session_id);
        assert_ne!(restarted.info.token, info.token);
        restarted.stop().await.unwrap();
    }

    #[tokio::test]
    async fn authentication_attempts_and_request_bodies_are_bounded() {
        let room = Room::new();
        *room.joins.lock().unwrap() = (Instant::now(), 30);
        let response = session_router(room.clone())
            .oneshot(join_request(&room, "invalid", ORIGINS[0], &room.session_id))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        let mut request = join_request(&room, &room.token, ORIGINS[0], &room.session_id);
        *request.body_mut() = Body::from("x".repeat(4097));
        let response = session_router(room).oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }
}
