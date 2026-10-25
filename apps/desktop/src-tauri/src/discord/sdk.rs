//! All SDK calls and callbacks live on the Discord worker thread.
use std::{
    collections::VecDeque,
    ffi::{c_char, c_void, CStr, CString},
};

pub struct Event {
    pub kind: i32,
    pub request: u64,
    pub id: u64,
    pub value: i64,
    pub a: String,
    pub b: String,
    pub c: String,
}
type Callback = unsafe extern "C" fn(
    *mut c_void,
    i32,
    u64,
    u64,
    i64,
    *const c_char,
    *const c_char,
    *const c_char,
);
unsafe extern "C" {
    fn veil_discord_create(
        context: *mut c_void,
        callback: Callback,
        register_launch: bool,
    ) -> *mut c_void;
    fn veil_discord_destroy(client: *mut c_void);
    fn veil_discord_pump(client: *mut c_void);
    fn veil_discord_authorize(client: *mut c_void, attempt: u64);
    fn veil_discord_refresh(client: *mut c_void, attempt: u64, token: *const c_char);
    fn veil_discord_connect(client: *mut c_void, token: *const c_char, preserve_ready: bool);
    fn veil_discord_cancel(client: *mut c_void);
    fn veil_discord_pause(client: *mut c_void);
    fn veil_discord_disconnect(client: *mut c_void, token: *const c_char);
    fn veil_discord_friends(client: *mut c_void);
    fn veil_discord_activity(
        client: *mut c_void,
        generation: u64,
        enabled: bool,
        details: *const c_char,
        state: *const c_char,
        link: *const c_char,
        party: *const c_char,
        count: i32,
        public_join: bool,
    );
    fn veil_discord_send(client: *mut c_void, request: u64, user: u64, generation: u64);
    fn veil_discord_accept(client: *mut c_void, request: u64, invitation: u64);
    fn veil_discord_dismiss(client: *mut c_void, invitation: u64);
    fn veil_discord_request_join(client: *mut c_void, request: u64, user: u64);
    fn veil_discord_reply_join(client: *mut c_void, request: u64, join_request: u64);
    fn veil_discord_dismiss_join(client: *mut c_void, join_request: u64);
}
#[allow(clippy::too_many_arguments)] // Fixed C callback ABI.
unsafe extern "C" fn receive(
    context: *mut c_void,
    kind: i32,
    request: u64,
    id: u64,
    value: i64,
    a: *const c_char,
    b: *const c_char,
    c: *const c_char,
) {
    // The bridge owns each string for the duration of this callback. Callbacks
    // run only while this worker pumps; no SDK thread mutates the queue.
    let queue = &mut *(context as *mut VecDeque<Event>);
    if queue.len() >= 4096 {
        return;
    }
    let text = |p| CStr::from_ptr(p).to_string_lossy().into_owned();
    queue.push_back(Event {
        kind,
        request,
        id,
        value,
        a: text(a),
        b: text(b),
        c: text(c),
    });
}
fn string(value: &str) -> CString {
    CString::new(value).unwrap_or_default()
}
pub struct Client {
    raw: *mut c_void,
    #[allow(clippy::box_collection)] // C++ retains the address of the queue header across moves.
    events: Box<VecDeque<Event>>,
}
impl Client {
    pub fn new(register_launch: bool) -> Option<Self> {
        let mut events = Box::new(VecDeque::new());
        let raw = unsafe {
            veil_discord_create(
                (&mut *events as *mut VecDeque<Event>).cast(),
                receive,
                register_launch,
            )
        };
        (!raw.is_null()).then_some(Self { raw, events })
    }
    pub fn pump(&mut self) -> VecDeque<Event> {
        unsafe { veil_discord_pump(self.raw) };
        std::mem::take(&mut *self.events)
    }
    pub fn authorize(&mut self, id: u64) {
        unsafe { veil_discord_authorize(self.raw, id) }
    }
    pub fn refresh(&mut self, id: u64, token: &str) {
        unsafe { veil_discord_refresh(self.raw, id, string(token).as_ptr()) }
    }
    pub fn connect(&mut self, token: &str, preserve_ready: bool) {
        unsafe { veil_discord_connect(self.raw, string(token).as_ptr(), preserve_ready) }
    }
    pub fn cancel(&mut self) {
        unsafe { veil_discord_cancel(self.raw) }
    }
    pub fn pause(&mut self) {
        unsafe { veil_discord_pause(self.raw) }
    }
    pub fn disconnect(&mut self, token: &str) {
        unsafe { veil_discord_disconnect(self.raw, string(token).as_ptr()) }
    }
    pub fn friends(&mut self) {
        unsafe { veil_discord_friends(self.raw) }
    }
    #[allow(clippy::too_many_arguments)] // Narrow bridge mirrors SDK activity fields.
    pub fn activity(
        &mut self,
        generation: u64,
        enabled: bool,
        details: &str,
        state: &str,
        link: &str,
        party: &str,
        count: i32,
        public_join: bool,
    ) {
        unsafe {
            veil_discord_activity(
                self.raw,
                generation,
                enabled,
                string(details).as_ptr(),
                string(state).as_ptr(),
                string(link).as_ptr(),
                string(party).as_ptr(),
                count,
                public_join,
            )
        }
    }
    pub fn send(&mut self, request: u64, user: u64, generation: u64) {
        unsafe { veil_discord_send(self.raw, request, user, generation) }
    }
    pub fn accept(&mut self, request: u64, invitation: u64) {
        unsafe { veil_discord_accept(self.raw, request, invitation) }
    }
    pub fn dismiss(&mut self, invitation: u64) {
        unsafe { veil_discord_dismiss(self.raw, invitation) }
    }
    pub fn request_join(&mut self, request: u64, user: u64) {
        unsafe { veil_discord_request_join(self.raw, request, user) }
    }
    pub fn reply_join(&mut self, request: u64, join_request: u64) {
        unsafe { veil_discord_reply_join(self.raw, request, join_request) }
    }
    pub fn dismiss_join(&mut self, join_request: u64) {
        unsafe { veil_discord_dismiss_join(self.raw, join_request) }
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        unsafe { veil_discord_destroy(self.raw) }
    }
}
