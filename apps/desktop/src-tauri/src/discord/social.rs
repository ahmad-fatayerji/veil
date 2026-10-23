//! Narrow native Social SDK commands. OAuth tokens never enter these snapshots.
#![cfg_attr(not(veil_discord_sdk), allow(dead_code, unused_imports))]
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::sync::oneshot;

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    id: String,
    display_name: String,
    username: String,
    avatar_revision: String,
}
#[derive(Clone, Serialize)]
pub struct Invitation {
    id: String,
    person: Person,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    available: bool,
    status: String,
    person: Option<Person>,
    friends: Vec<Person>,
    invitations: Vec<Invitation>,
    warning: Option<String>,
    version: u64,
    invite_ready: bool,
    consent_epoch: u64,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            available: cfg!(veil_discord_sdk),
            status: if cfg!(veil_discord_sdk) {
                "disconnected"
            } else {
                "unavailable"
            }
            .into(),
            person: None,
            friends: vec![],
            invitations: vec![],
            warning: None,
            version: 0,
            invite_ready: false,
            consent_epoch: 0,
        }
    }
}
#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    owner: String,
    document_id: String,
    document_title: String,
    link: String,
    generation: u64,
    participant_count: u32,
}
type Reply = oneshot::Sender<Result<String, String>>;
enum Command {
    Connect,
    Cancel,
    Disconnect,
    Friends,
    KnownLinks(Vec<String>),
    Selection(String, u64, Option<Selection>),
    Send(String, String, u64, String, Reply),
    Review(String, Reply),
    Dismiss(String),
}

/// Scope consent to one WebView workspace and monotonically reject stale
/// selection/clear commands, including commands delayed across a WebView reload.
#[derive(Default)]
struct ConsentGuard {
    owner: String,
    revision: u64,
    retired: VecDeque<String>,
}

// Correlate SDK message invites and activity-join callbacks without depending on
// host/guest role. Party IDs are opaque fingerprints, never the bearer link.
fn invitation_party(link: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in link.bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
    }
    format!("veil:{hash:016x}")
}
#[derive(Default)]
struct InvitationRouting {
    known: Vec<String>,
    consumed: VecDeque<String>,
    parties: HashMap<String, String>,
}
impl InvitationRouting {
    fn blocked_party(&self, party: &str) -> bool {
        self.known
            .iter()
            .any(|link| invitation_party(link) == party)
            || self.consumed.iter().any(|item| item == party)
    }
    fn consume(&mut self, link: &str) {
        let party = invitation_party(link);
        if !self.consumed.contains(&party) {
            self.consumed.push_back(party);
            if self.consumed.len() > 128 {
                self.consumed.pop_front();
            }
        }
    }
}
impl ConsentGuard {
    fn accept(&mut self, owner: String, revision: u64) -> bool {
        if owner != self.owner {
            if self.retired.contains(&owner) {
                return false;
            }
            if !self.owner.is_empty() {
                self.retired.push_back(std::mem::take(&mut self.owner));
                if self.retired.len() > 32 {
                    self.retired.pop_front();
                }
            }
            self.owner = owner;
            self.revision = 0;
        }
        if revision < self.revision {
            return false;
        }
        self.revision = revision;
        true
    }
    fn revoke(&mut self) {
        self.revision += 1;
    }
}
struct View {
    snapshot: Snapshot,
    avatars: HashMap<String, String>,
    epoch: u64,
    images: HashMap<String, (String, String)>,
}
impl View {
    fn clear_identity(&mut self) {
        self.epoch += 1;
        self.avatars.clear();
        self.images.clear();
        self.snapshot.person = None;
        self.snapshot.friends.clear();
        self.snapshot.invitations.clear();
        self.snapshot.invite_ready = false;
        self.snapshot.version += 1;
    }
}
pub struct Social {
    sender: mpsc::SyncSender<Command>,
    view: Arc<Mutex<View>>,
    avatar_slots: tokio::sync::Semaphore,
}
pub struct Worker {
    receiver: mpsc::Receiver<Command>,
    view: Arc<Mutex<View>>,
}
pub fn setup(app: &AppHandle) -> Worker {
    let (sender, receiver) = mpsc::sync_channel(64);
    let view = Arc::new(Mutex::new(View {
        snapshot: Snapshot::default(),
        avatars: HashMap::new(),
        epoch: 0,
        images: HashMap::new(),
    }));
    app.manage(Social {
        sender,
        view: view.clone(),
        avatar_slots: tokio::sync::Semaphore::new(4),
    });
    Worker { receiver, view }
}
fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    super::authorize(caller)
}
fn enqueue(state: &Social, command: Command) -> Result<(), String> {
    if !state.view.lock().unwrap().snapshot.available {
        return Err("Discord connections are not available in this build.".into());
    }
    state
        .sender
        .try_send(command)
        .map_err(|_| "Discord is busy. Try again shortly.".into())
}
#[tauri::command]
pub fn discord_social_snapshot(
    caller: WebviewWindow,
    state: State<'_, Social>,
    after_version: Option<u64>,
) -> Result<Option<Snapshot>, String> {
    authorize(&caller)?;
    let view = state.view.lock().unwrap();
    Ok((after_version != Some(view.snapshot.version)).then(|| view.snapshot.clone()))
}
#[tauri::command]
pub fn discord_connect(caller: WebviewWindow, state: State<'_, Social>) -> Result<(), String> {
    authorize(&caller)?;
    enqueue(&state, Command::Connect)
}
#[tauri::command]
pub fn discord_cancel_connection(
    caller: WebviewWindow,
    state: State<'_, Social>,
) -> Result<(), String> {
    authorize(&caller)?;
    enqueue(&state, Command::Cancel)
}
#[tauri::command]
pub fn discord_disconnect(caller: WebviewWindow, state: State<'_, Social>) -> Result<(), String> {
    authorize(&caller)?;
    enqueue(&state, Command::Disconnect)
}
#[tauri::command]
pub fn discord_refresh_friends(
    caller: WebviewWindow,
    state: State<'_, Social>,
) -> Result<(), String> {
    authorize(&caller)?;
    enqueue(&state, Command::Friends)
}
#[tauri::command]
pub fn discord_known_links(
    caller: WebviewWindow,
    state: State<'_, Social>,
    links: Vec<String>,
) -> Result<(), String> {
    authorize(&caller)?;
    let links = links
        .into_iter()
        .filter(|link| validate_link(link).is_ok())
        .collect();
    enqueue(&state, Command::KnownLinks(links))
}
#[tauri::command]
pub fn discord_select_document(
    caller: WebviewWindow,
    state: State<'_, Social>,
    mut selection: Option<Selection>,
    owner: String,
    revision: u64,
) -> Result<(), String> {
    authorize(&caller)?;
    if owner.len() != 36 || !owner.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return Err("Invalid Discord workspace.".into());
    }
    if let Some(selection) = &mut selection {
        validate_link(&selection.link)?;
        if selection.owner != owner || selection.generation != revision {
            return Err("Invalid Discord consent generation.".into());
        }
        selection.document_title = super::title(&selection.document_title);
        if selection.document_id.is_empty()
            || selection.document_id.len() > 128
            || selection.generation == 0
            || selection.participant_count == 0
            || selection.participant_count > i32::MAX as u32
        {
            return Err("Invalid Discord document selection.".into());
        }
    }
    enqueue(&state, Command::Selection(owner, revision, selection))
}
async fn response(receiver: oneshot::Receiver<Result<String, String>>) -> Result<String, String> {
    tokio::time::timeout(Duration::from_secs(20), receiver)
        .await
        .map_err(|_| "Discord did not respond. Try again or copy the link.".to_string())?
        .map_err(|_| "Discord is unavailable.".to_string())?
}
#[tauri::command]
pub async fn discord_send_invite(
    caller: WebviewWindow,
    state: State<'_, Social>,
    person_id: String,
    document_id: String,
    generation: u64,
    owner: String,
) -> Result<String, String> {
    authorize(&caller)?;
    let (tx, rx) = oneshot::channel();
    enqueue(
        &state,
        Command::Send(person_id, document_id, generation, owner, tx),
    )?;
    response(rx).await
}
#[tauri::command]
pub async fn discord_review_invite(
    caller: WebviewWindow,
    state: State<'_, Social>,
    invitation_id: String,
) -> Result<String, String> {
    authorize(&caller)?;
    let (tx, rx) = oneshot::channel();
    enqueue(&state, Command::Review(invitation_id, tx))?;
    response(rx).await
}
#[tauri::command]
pub fn discord_dismiss_invite(
    caller: WebviewWindow,
    state: State<'_, Social>,
    invitation_id: String,
) -> Result<(), String> {
    authorize(&caller)?;
    enqueue(&state, Command::Dismiss(invitation_id))
}

#[tauri::command]
pub async fn discord_avatar(
    caller: WebviewWindow,
    state: State<'_, Social>,
    person_id: String,
) -> Result<Option<String>, String> {
    use base64::Engine;
    authorize(&caller)?;
    let (url, epoch) = {
        let view = state.view.lock().unwrap();
        (view.avatars.get(&person_id).cloned(), view.epoch)
    };
    let Some(url) = url else {
        return Ok(None);
    };
    if let Some((cached_url, image)) = state.view.lock().unwrap().images.get(&person_id) {
        if *cached_url == url {
            return Ok(Some(image.clone()));
        }
    }
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid avatar.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("cdn.discordapp.com") {
        return Ok(None);
    }
    let _permit = state
        .avatar_slots
        .acquire()
        .await
        .map_err(|_| "Avatar unavailable.".to_string())?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "Avatar unavailable.".to_string())?;
    let mut reply = client
        .get(parsed)
        .send()
        .await
        .map_err(|_| "Avatar unavailable.".to_string())?;
    if !reply.status().is_success() {
        return Ok(None);
    }
    let mime = reply
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .to_owned();
    if !matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    ) {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = reply
        .chunk()
        .await
        .map_err(|_| "Avatar unavailable.".to_string())?
    {
        if bytes.len() + chunk.len() > 192 * 1024 {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut view = state.view.lock().unwrap();
    if view.epoch != epoch || view.avatars.get(&person_id) != Some(&url) {
        return Ok(None);
    }
    let image = format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    if view.images.len() >= 64 {
        view.images.clear();
    }
    view.images.insert(person_id, (url, image.clone()));
    Ok(Some(image))
}

fn validate_link(link: &str) -> Result<(), String> {
    let invalid = || "This is not a supported Discord invitation payload.".to_string();
    if !link.is_ascii() || link.len() > 128 {
        return Err(invalid());
    }
    let pieces: Vec<_> = link.split('/').collect();
    if pieces.len() != 5 || pieces[0] != "veil:" || !pieces[1].is_empty() || pieces[2] != "join" {
        return Err(invalid());
    }
    let code = pieces[4];
    if code.len() != 22
        || !code
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        || !matches!(code.as_bytes()[21], b'A' | b'Q' | b'g' | b'w')
    {
        return Err(invalid());
    }
    let mut authority = Vec::new();
    let mut encoded = pieces[3].bytes();
    while let Some(byte) = encoded.next() {
        if byte == b'%' {
            let a = encoded.next().ok_or_else(invalid)?;
            let b = encoded.next().ok_or_else(invalid)?;
            let hex = std::str::from_utf8(&[a, b])
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
                .ok_or_else(invalid)?;
            authority.push(hex);
        } else {
            authority.push(byte);
        }
    }
    let host = String::from_utf8(authority).map_err(|_| invalid())?;
    let url = reqwest::Url::parse(&format!("https://{host}")).map_err(|_| invalid())?;
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || host.chars().any(char::is_control)
    {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(veil_discord_sdk)]
pub(super) fn run(shared: super::Shared, worker: Worker) {
    use super::{
        auth::{Authorization, Operation, SessionVault, Tokens},
        sdk::Client,
    };
    let mut sdk = match Client::new(!cfg!(debug_assertions)) {
        Some(sdk) => sdk,
        None => {
            let mut view = worker.view.lock().unwrap();
            view.snapshot.available = false;
            view.snapshot.status = "unavailable".into();
            view.snapshot.warning = Some("The Discord SDK could not start.".into());
            view.snapshot.version += 1;
            drop(view);
            super::run(shared);
            return;
        }
    };
    let mut auth = match Authorization::restore(SessionVault::for_process()) {
        Ok(auth) => auth,
        Err(_) => {
            let mut view = worker.view.lock().unwrap();
            view.snapshot.warning = Some("Saved Discord credentials could not be read. Disconnect to remove them, then connect again.".into());
            view.snapshot.version += 1;
            Authorization::empty(SessionVault::for_process())
        }
    };
    let mut attempt = None;
    let mut selection: Option<Selection> = None;
    let mut consent = ConsentGuard::default();
    let mut sequence = 1_u64;
    let mut revision = 1_u64;
    let mut activity_key = String::new();
    let mut pending: HashMap<u64, (Instant, Reply)> = HashMap::new();
    let mut review_ids: HashMap<u64, String> = HashMap::new();
    let mut links: HashMap<String, String> = HashMap::new();
    let mut routing = InvitationRouting::default();
    let mut recent = VecDeque::<(Instant, String)>::new();
    let mut disconnect_at = None;
    let mut refresh_retry = None;
    let mut refresh_failures = 0_u32;
    let mut send_after = Instant::now();
    let mut friend_batch = Vec::new();
    let mut legacy = super::transport::Client::new();
    let mut legacy_connected = false;
    let mut legacy_published = None;
    let mut legacy_sent = Instant::now() - super::HEARTBEAT_INTERVAL;
    let mut legacy_retry = Instant::now();
    if let Some(tokens) = auth.tokens() {
        if tokens.needs_refresh(now()) {
            if let Ok(next) = auth.begin(Operation::Refresh) {
                sdk.refresh(next.id(), auth.tokens().unwrap().refresh_token());
                attempt = Some(next);
            }
        } else {
            sdk.connect(tokens.access_token(), false);
        }
        let mut view = worker.view.lock().unwrap();
        view.snapshot.status = "connecting".into();
        view.snapshot.version += 1;
    }
    loop {
        let (preferences, activity, active, stop) = {
            let model = shared.0.lock().unwrap();
            (
                model.snapshot.preferences,
                model.activity.clone(),
                model.active,
                model.stop,
            )
        };
        if stop {
            if legacy_connected {
                let _ = legacy.clear();
                legacy.disconnect();
            }
            sdk.activity(0, false, "", "", "", "", 1);
            sdk.pump();
            return;
        }
        while let Ok(command) = worker.receiver.try_recv() {
            match command {
                Command::Connect => {
                    if disconnect_at.is_some() || attempt.is_some() {
                        continue;
                    }
                    match auth.begin(Operation::Authorize) {
                        Ok(next) => {
                            attempt = Some(next);
                            sdk.authorize(next.id());
                            let mut view = worker.view.lock().unwrap();
                            view.snapshot.status = "authorizing".into();
                            view.snapshot.warning = None;
                            view.snapshot.version += 1;
                        }
                        Err(error) => {
                            worker.view.lock().unwrap().snapshot.warning = Some(error.to_string())
                        }
                    }
                }
                Command::Cancel => {
                    if let Some(current) = attempt.take() {
                        let _ = auth.cancel(current);
                    }
                    sdk.cancel();
                    if let Some(tokens) = auth.tokens() {
                        sdk.connect(tokens.access_token(), false);
                    }
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.status = if auth.tokens().is_some() {
                        "connecting"
                    } else {
                        "disconnected"
                    }
                    .into();
                    view.snapshot.version += 1;
                }
                Command::Disconnect => {
                    let token = auth
                        .tokens()
                        .map(|tokens| tokens.access_token().to_owned())
                        .unwrap_or_default();
                    let error = auth.disconnect().err();
                    attempt = None;
                    if selection.take().is_some() {
                        consent.revoke();
                    }
                    links.clear();
                    for (_, (_, reply)) in pending.drain() {
                        let _ = reply.send(Err("Discord was disconnected.".into()));
                    }
                    // Discord revocation can affect other grants for this app/user.
                    // Debug disconnect only forgets its own local authorization.
                    sdk.disconnect(if cfg!(debug_assertions) { "" } else { &token });
                    disconnect_at = Some(Instant::now());
                    let mut view = worker.view.lock().unwrap();
                    view.epoch += 1;
                    view.avatars.clear();
                    view.images.clear();
                    view.snapshot.person = None;
                    view.snapshot.friends.clear();
                    view.snapshot.invitations.clear();
                    view.snapshot.status = "disconnecting".into();
                    view.snapshot.consent_epoch += 1;
                    view.snapshot.warning = error.map(|error| error.to_string());
                    view.snapshot.version += 1;
                }
                Command::Friends => sdk.friends(),
                Command::KnownLinks(known) => {
                    routing.known = known;
                    let mut view = worker.view.lock().unwrap();
                    let previous = view.snapshot.invitations.len();
                    view.snapshot.invitations.retain(|item| {
                        !routing
                            .parties
                            .get(&item.id)
                            .is_some_and(|party| routing.blocked_party(party))
                            && !links
                                .get(&item.id)
                                .is_some_and(|link| routing.blocked_party(&invitation_party(link)))
                    });
                    if previous != view.snapshot.invitations.len() {
                        view.snapshot.version += 1;
                    }
                    links.retain(|id, _| {
                        view.snapshot.invitations.iter().any(|item| item.id == *id)
                    });
                }
                Command::Selection(owner, revision, next) => {
                    if !consent.accept(owner, revision) {
                        continue;
                    }
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.invite_ready = false;
                    view.snapshot.version += 1;
                    selection = next;
                    activity_key.clear();
                }
                Command::Send(person, document, generation, owner, reply) => {
                    if Instant::now() < send_after {
                        let _ = reply.send(Err("rate-limit".into()));
                        continue;
                    }
                    let valid = consent.owner == owner
                        && selection.as_ref().is_some_and(|selected| {
                            selected.document_id == document && selected.generation == generation
                        })
                        && preferences.enabled
                        && preferences.show_participant_count;
                    if !valid || pending.len() >= 16 {
                        let _ = reply.send(Err("stale-document".into()));
                        continue;
                    }
                    if let Ok(person) = person.parse::<u64>() {
                        sequence += 1;
                        pending.insert(sequence, (Instant::now(), reply));
                        sdk.send(sequence, person, revision);
                    } else {
                        let _ = reply.send(Err("not-friend".into()));
                    }
                }
                Command::Review(id, reply) => {
                    if review_ids.values().any(|current| *current == id) {
                        let _ =
                            reply.send(Err("This invitation is already being reviewed.".into()));
                        continue;
                    }
                    if let Some(link) = links.remove(&id) {
                        routing.consume(&link);
                        let _ = reply.send(Ok(link));
                        let mut view = worker.view.lock().unwrap();
                        view.snapshot.invitations.retain(|item| item.id != id);
                        view.snapshot.version += 1;
                    } else if let Ok(invite) = id.parse() {
                        sequence += 1;
                        review_ids.insert(sequence, id.clone());
                        pending.insert(sequence, (Instant::now(), reply));
                        sdk.accept(sequence, invite);
                    } else {
                        let _ = reply.send(Err("This invitation is no longer available.".into()));
                    }
                }
                Command::Dismiss(id) => {
                    links.remove(&id);
                    if let Ok(invite) = id.parse() {
                        sdk.dismiss(invite);
                    }
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.invitations.retain(|item| item.id != id);
                    view.snapshot.version += 1;
                }
            }
        }
        let selected_activity = selection.as_ref().map(|selected| super::Activity {
            document_title: Some(selected.document_title.clone()),
            others_count: selected.participant_count.saturating_sub(1),
        });
        let display = super::display(preferences, selected_activity.as_ref().unwrap_or(&activity));
        let ready = worker.view.lock().unwrap().snapshot.status == "connected";
        // Preserve the existing unauthenticated text-only presence path. It is
        // stopped before the SDK owns publication, so the two cannot compete.
        if ready || !active || !preferences.enabled || !super::unlinked_presence_allowed() {
            if legacy_connected {
                let _ = legacy.clear();
                legacy.disconnect();
                legacy_connected = false;
            }
            legacy_published = None;
        } else if Instant::now() >= legacy_retry
            && legacy_sent.elapsed() >= super::UPDATE_INTERVAL
            && (legacy_published.as_ref() != Some(&display)
                || legacy_sent.elapsed() >= super::HEARTBEAT_INTERVAL)
        {
            let result = (|| {
                if !legacy_connected {
                    legacy.connect()?;
                    legacy_connected = true;
                }
                legacy.publish(&display)
            })();
            if result.is_ok() {
                legacy_published = Some(super::DisplayActivity {
                    details: display.details.clone(),
                    state: display.state.clone(),
                });
                legacy_sent = Instant::now();
            } else {
                legacy.disconnect();
                legacy_connected = false;
                legacy_retry = Instant::now() + Duration::from_secs(5);
            }
        }
        let join = if ready && preferences.enabled && preferences.show_participant_count {
            selection.as_ref().map(|s| s.link.as_str()).unwrap_or("")
        } else {
            ""
        };
        let count = selection
            .as_ref()
            .map_or(1, |s| s.participant_count.min(i32::MAX as u32) as i32);
        let key = format!(
            "{}:{}:{}:{}:{}:{}",
            active,
            preferences.enabled,
            display.details,
            display.state.as_deref().unwrap_or(""),
            join,
            count
        );
        if key != activity_key {
            revision += 1;
            activity_key = key;
            let party = selection
                .as_ref()
                .map(|s| invitation_party(&s.link))
                .unwrap_or_default();
            sdk.activity(
                revision,
                active && preferences.enabled,
                &display.details,
                display.state.as_deref().unwrap_or(""),
                join,
                &party,
                count,
            );
        }
        for event in sdk.pump() {
            match event.kind {
                1 => {
                    let mut view = worker.view.lock().unwrap();
                    if disconnect_at.is_none()
                        && !matches!(view.snapshot.status.as_str(), "authorizing" | "expired")
                    {
                        view.snapshot.status = match event.value {
                            3 => "connected",
                            1 | 2 | 6 => "connecting",
                            4 => "reconnecting",
                            _ if auth.tokens().is_some() => "reconnecting",
                            _ => "disconnected",
                        }
                        .into();
                        if event.value != 3 && selection.take().is_some() {
                            consent.revoke();
                            view.snapshot.consent_epoch += 1;
                            view.snapshot.invite_ready = false;
                        }
                        view.snapshot.version += 1;
                    }
                }
                2 | 4 | 10 => {
                    if disconnect_at.is_some() || auth.tokens().is_none() {
                        continue;
                    }
                    if event.kind == 10
                        && routing
                            .parties
                            .get(&event.request.to_string())
                            .is_some_and(|party| routing.blocked_party(party))
                    {
                        sdk.dismiss(event.request);
                        continue;
                    }
                    let person = Person {
                        id: event.id.to_string(),
                        display_name: super::title(&event.a),
                        username: if event.b.is_empty() {
                            String::new()
                        } else {
                            super::title(&event.b)
                        },
                        avatar_revision: {
                            use std::hash::{Hash, Hasher};
                            let mut hash = std::collections::hash_map::DefaultHasher::new();
                            event.c.hash(&mut hash);
                            format!("{:x}", hash.finish())
                        },
                    };
                    let mut view = worker.view.lock().unwrap();
                    if view.avatars.get(&person.id) != Some(&event.c) {
                        view.avatars.insert(person.id.clone(), event.c);
                    }
                    if event.kind == 2 {
                        view.snapshot.person = Some(person);
                    } else if event.kind == 4 {
                        friend_batch.push(person);
                    } else if view.snapshot.invitations.len() < 32 {
                        let id = event.request.to_string();
                        if view
                            .snapshot
                            .person
                            .as_ref()
                            .is_some_and(|person| person.id == event.id.to_string())
                        {
                            continue;
                        }
                        // A Discord-side accept can arrive before its message event.
                        if let Some(party) = routing.parties.get(&id) {
                            if let Some(existing) =
                                view.snapshot.invitations.iter_mut().find(|item| {
                                    links
                                        .get(&item.id)
                                        .is_some_and(|link| invitation_party(link) == *party)
                                })
                            {
                                existing.person = person;
                                view.snapshot.version += 1;
                                sdk.dismiss(event.request);
                                continue;
                            }
                        }
                        if !view.snapshot.invitations.iter().any(|i| i.id == id) {
                            view.snapshot.invitations.push(Invitation { id, person });
                        }
                    }
                    view.snapshot.version += 1;
                }
                3 => friend_batch.clear(),
                5 => {
                    let mut view = worker.view.lock().unwrap();
                    if view.snapshot.friends != friend_batch {
                        view.snapshot.friends = std::mem::take(&mut friend_batch);
                        view.snapshot.version += 1;
                    }
                }
                6 => {
                    if let Some(current) = attempt.filter(|a| a.id() == event.request) {
                        match Tokens::from_grant(
                            event.a,
                            event.b,
                            event.value.try_into().unwrap_or(0),
                            event.c,
                            now(),
                        ) {
                            Ok(tokens) => {
                                refresh_failures = 0;
                                refresh_retry = None;
                                let result = auth.complete(current, tokens);
                                attempt = None;
                                if let Some(tokens) = auth.tokens() {
                                    sdk.connect(tokens.access_token(), current.is_refresh());
                                }
                                let mut view = worker.view.lock().unwrap();
                                if !current.is_refresh() || view.snapshot.status != "connected" {
                                    view.snapshot.status = "connecting".into();
                                }
                                view.snapshot.warning = result.err().map(|e| e.to_string());
                                view.snapshot.version += 1;
                            }
                            Err(error) => {
                                let _ = auth.cancel(current);
                                attempt = None;
                                let mut view = worker.view.lock().unwrap();
                                view.snapshot.status = "expired".into();
                                view.snapshot.warning = Some(error.to_string());
                                view.snapshot.version += 1;
                            }
                        }
                    }
                }
                7 => {
                    let refreshing = attempt.is_some_and(|current| current.is_refresh());
                    if let Some(current) = attempt.take() {
                        if event.value == 1 {
                            let _ = auth.invalid_authorization(current);
                        } else {
                            let _ = auth.cancel(current);
                        }
                    } else if event.value == 1 {
                        let _ = auth.disconnect();
                    }
                    if event.value == 1 {
                        sdk.pause();
                        worker.view.lock().unwrap().clear_identity();
                        links.clear();
                        for (_, (_, reply)) in pending.drain() {
                            let _ = reply.send(Err("connection".into()));
                        }
                        review_ids.clear();
                    }
                    if refreshing && event.value != 1 && refresh_failures < 3 {
                        refresh_failures += 1;
                        refresh_retry =
                            Some(Instant::now() + Duration::from_secs(2_u64.pow(refresh_failures)));
                        let mut view = worker.view.lock().unwrap();
                        view.snapshot.warning =
                            Some("Discord token renewal was interrupted. Retrying shortly.".into());
                        view.snapshot.version += 1;
                        continue;
                    }
                    if selection.take().is_some() {
                        consent.revoke();
                    }
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.consent_epoch += 1;
                    view.snapshot.status = if event.value == 1 {
                        "expired"
                    } else {
                        "disconnected"
                    }
                    .into();
                    view.snapshot.warning = Some(
                        "Discord authorization could not be completed. Try connecting again."
                            .into(),
                    );
                    view.snapshot.version += 1;
                }
                8 if event.value == 0 => {
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.invite_ready = false;
                    view.snapshot.warning = Some("Discord activity could not be updated. Try again before sending an invite.".into());
                    view.snapshot.version += 1;
                }
                8 if event.value != 0 && event.request == revision => {
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.invite_ready = selection.is_some();
                    view.snapshot.version += 1;
                    if view
                        .snapshot
                        .warning
                        .as_deref()
                        .is_some_and(|message| message.starts_with("Discord activity could not"))
                    {
                        view.snapshot.warning = None;
                    }
                }
                9 => {
                    if event.value == 3 {
                        send_after = Instant::now()
                            + Duration::from_secs(if event.id == 0 {
                                60
                            } else {
                                event.id.clamp(1, 3600)
                            });
                    }
                    if let Some((_, reply)) = pending.remove(&event.request) {
                        let result = if event.value == -1 {
                            Ok(String::new())
                        } else {
                            Err(match event.value {
                                1 => "connection",
                                2 => "not-friend",
                                3 => "rate-limit",
                                4 => "stale-document",
                                _ => "unavailable",
                            }
                            .into())
                        };
                        let _ = reply.send(result);
                    }
                }
                11 => {
                    if validate_link(&event.a).is_ok()
                        && !routing.blocked_party(&invitation_party(&event.a))
                        && !recent.iter().any(|(time, link)| {
                            time.elapsed() < Duration::from_secs(10) && *link == event.a
                        })
                    {
                        let party = invitation_party(&event.a);
                        let existing = {
                            let view = worker.view.lock().unwrap();
                            view.snapshot
                                .invitations
                                .iter()
                                .find(|item| routing.parties.get(&item.id) == Some(&party))
                                .map(|item| item.id.clone())
                        };
                        if let Some(id) = existing {
                            links.insert(id, event.a);
                            continue;
                        }
                        sequence += 1;
                        let id = format!("join-{sequence}");
                        recent.push_back((Instant::now(), event.a.clone()));
                        if recent.len() > 32 {
                            recent.pop_front();
                        }
                        let mut view = worker.view.lock().unwrap();
                        if view.snapshot.invitations.len() < 32 {
                            links.insert(id.clone(), event.a);
                            view.snapshot.invitations.push(Invitation {
                                id,
                                person: Person {
                                    id: "0".into(),
                                    display_name: "Discord invitation".into(),
                                    username: String::new(),
                                    avatar_revision: String::new(),
                                },
                            });
                            view.snapshot.version += 1;
                        }
                    }
                }
                12 => {
                    disconnect_at = None;
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.status = "disconnected".into();
                    if event.value == 0 {
                        view.snapshot.warning = Some("Disconnected locally. Discord could not confirm revocation; remove Veil under Discord Authorized Apps if needed.".into());
                    }
                    view.snapshot.version += 1;
                }
                13 => {
                    if attempt.is_none() && auth.tokens().is_some() {
                        if let Ok(next) = auth.begin(Operation::Refresh) {
                            sdk.refresh(next.id(), auth.tokens().unwrap().refresh_token());
                            attempt = Some(next);
                        }
                    }
                }
                14 => {
                    let mut view = worker.view.lock().unwrap();
                    view.snapshot.warning =
                        Some("Discord could not register Veil for invitation launches.".into());
                    view.snapshot.version += 1;
                }
                15 => {
                    let review_id = review_ids.remove(&event.request);
                    if let Some((_, reply)) = pending.remove(&event.request) {
                        let result = if event.value != 0 {
                            validate_link(&event.a).map(|_| {
                                routing.consume(&event.a);
                                let duplicates: Vec<_> = links
                                    .iter()
                                    .filter(|(_, link)| **link == event.a)
                                    .map(|(id, _)| id.clone())
                                    .collect();
                                for id in &duplicates {
                                    links.remove(id);
                                }
                                let mut view = worker.view.lock().unwrap();
                                view.snapshot.invitations.retain(|item| {
                                    !duplicates.contains(&item.id)
                                        && Some(&item.id) != review_id.as_ref()
                                        && routing.parties.get(&item.id)
                                            != Some(&invitation_party(&event.a))
                                });
                                view.snapshot.version += 1;
                                recent.push_back((Instant::now(), event.a.clone()));
                                if recent.len() > 32 {
                                    recent.pop_front();
                                }
                                event.a
                            })
                        } else {
                            Err("This Discord invitation is no longer available. Ask the host for a new link.".into())
                        };
                        let _ = reply.send(result);
                    }
                }
                16 if routing.parties.len() < 64 => {
                    routing.parties.insert(event.request.to_string(), event.a);
                }
                _ => {}
            }
        }
        pending.retain(|_, (started, reply)| {
            !reply.is_closed() && started.elapsed() < Duration::from_secs(19)
        });
        review_ids.retain(|request, _| pending.contains_key(request));
        routing.parties.retain(|id, _| {
            worker
                .view
                .lock()
                .unwrap()
                .snapshot
                .invitations
                .iter()
                .any(|item| item.id == *id)
        });
        if refresh_retry.is_some_and(|time| Instant::now() >= time)
            && attempt.is_none()
            && auth.tokens().is_some()
        {
            refresh_retry = None;
            if let Ok(next) = auth.begin(Operation::Refresh) {
                sdk.refresh(next.id(), auth.tokens().unwrap().refresh_token());
                attempt = Some(next);
            }
        }
        if disconnect_at.is_some_and(|time| time.elapsed() > Duration::from_secs(15)) {
            disconnect_at = None;
            let mut view = worker.view.lock().unwrap();
            view.snapshot.status = "disconnected".into();
            view.snapshot.warning =
                Some("Disconnected locally. Discord did not confirm token revocation.".into());
            view.snapshot.version += 1;
        }
        let guard = shared.0.lock().unwrap();
        let _ = shared
            .1
            .wait_timeout(guard, Duration::from_millis(100))
            .unwrap();
    }
}
#[cfg(veil_discord_sdk)]
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::{invitation_party, ConsentGuard, InvitationRouting};

    #[test]
    fn own_or_joined_sessions_are_suppressed_without_hiding_other_invites() {
        let mut routing = InvitationRouting {
            known: vec!["hosted-session".into(), "joined-session".into()],
            ..Default::default()
        };
        assert!(routing.blocked_party(&invitation_party("hosted-session")));
        assert!(routing.blocked_party(&invitation_party("joined-session")));
        assert!(!routing.blocked_party(&invitation_party("different-session")));
        routing.known.clear();
        assert!(!routing.blocked_party(&invitation_party("hosted-session")));
    }

    #[test]
    fn reviewed_invite_cannot_resurface_as_generic_activity_join() {
        let mut routing = InvitationRouting::default();
        routing
            .parties
            .insert("message-42".into(), invitation_party("session"));
        routing.consume("session");
        assert!(routing.blocked_party(&invitation_party("session")));
        assert!(routing.blocked_party(&routing.parties["message-42"]));
        assert!(!routing.blocked_party(&invitation_party("other-session")));
    }

    #[test]
    fn clear_and_connection_loss_reject_delayed_selection() {
        let mut guard = ConsentGuard::default();
        assert!(guard.accept("workspace".into(), 1));
        assert!(guard.accept("workspace".into(), 2));
        assert!(!guard.accept("workspace".into(), 1));
        guard.revoke();
        assert!(!guard.accept("workspace".into(), 2));
        assert!(guard.accept("workspace".into(), 3));
    }

    #[test]
    fn reloaded_workspace_rejects_commands_from_previous_owner() {
        let mut guard = ConsentGuard::default();
        assert!(guard.accept("old".into(), 10));
        assert!(guard.accept("new".into(), 0));
        assert!(!guard.accept("old".into(), 11));
        assert!(guard.accept("new".into(), 1));
    }
}
