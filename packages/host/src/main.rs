use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use tokio::{
    sync::broadcast,
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
}

impl Room {
    fn new() -> Arc<Self> {
        let (updates, _) = broadcast::channel(128);
        Arc::new(Self {
            awareness: Mutex::new(Awareness::new(Doc::new())),
            awareness_owners: Mutex::new(HashSet::new()),
            updates,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        })
    }
}

fn trusted_request(headers: &HeaderMap) -> bool {
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    host == Some("127.0.0.1:4444") && origin.is_some_and(|value| ORIGINS.contains(&value))
}

async fn bootstrap(State(room): State<Arc<Room>>, headers: HeaderMap) -> Response {
    if !trusted_request(&headers) {
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
    if !trusted_request(&headers) {
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:4444").await?;
    println!("Veil M0 host listening on 127.0.0.1:4444 (loopback only; in-memory document)");
    axum::serve(listener, router(Room::new()))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
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
