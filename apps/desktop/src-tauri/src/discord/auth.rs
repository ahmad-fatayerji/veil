//! Native-only credentials and callback lifecycle for the Social SDK adapter.
//! Nothing in this module is a Tauri command or a frontend response.

use serde::{Deserialize, Serialize};

const SERVICE: &str = "dev.veil.desktop.discord";
const ACCOUNT: &str = "1562757675970863135";
const REFRESH_MARGIN: u64 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthError {
    Storage,
    InvalidCredentials,
    MissingScopes,
    Busy,
    StaleCallback,
    ReconnectRequired,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Storage => "Discord credentials could not be read or saved securely.",
            Self::InvalidCredentials => "Saved Discord authorization is invalid. Connect again.",
            Self::MissingScopes => "Discord did not grant the required connection permissions.",
            Self::Busy => "A Discord authorization operation is already in progress.",
            Self::StaleCallback => "This Discord authorization attempt is no longer active.",
            Self::ReconnectRequired => "Connect Discord again to continue.",
        })
    }
}

impl std::error::Error for AuthError {}

/// Intentionally has no Debug implementation. Serialize is used only by the
/// credential vault, never for a WebView event, snapshot or preferences file.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    scope: String,
}

impl Tokens {
    pub fn from_grant(
        access_token: String,
        refresh_token: String,
        expires_in: u32,
        scope: String,
        now: u64,
    ) -> Result<Self, AuthError> {
        let tokens = Self {
            access_token,
            refresh_token,
            expires_at: now
                .checked_add(u64::from(expires_in))
                .filter(|_| expires_in > 0)
                .ok_or(AuthError::InvalidCredentials)?,
            scope,
        };
        tokens.validate()?;
        Ok(tokens)
    }

    fn validate(&self) -> Result<(), AuthError> {
        if [&self.access_token, &self.refresh_token]
            .iter()
            .any(|token| {
                token.is_empty() || token.len() > 8192 || token.chars().any(char::is_control)
            })
            || self.expires_at == 0
            || self.scope.len() > 1024
        {
            return Err(AuthError::InvalidCredentials);
        }
        let scopes: Vec<_> = self.scope.split_ascii_whitespace().collect();
        if !scopes.contains(&"openid") || !scopes.contains(&"sdk.social_layer_presence") {
            return Err(AuthError::MissingScopes);
        }
        Ok(())
    }

    pub fn access_token(&self) -> &str {
        &self.access_token
    }

    pub fn refresh_token(&self) -> &str {
        &self.refresh_token
    }

    pub fn needs_refresh(&self, now: u64) -> bool {
        self.expires_at <= now.saturating_add(REFRESH_MARGIN)
    }
}

/// A single Credential Manager record keeps rotated access and refresh tokens
/// together. It is scoped separately from hosting credentials and by app ID.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    tokens: Tokens,
}

pub trait TokenVault {
    fn load(&self) -> Result<Option<Tokens>, AuthError>;
    fn save(&self, tokens: &Tokens) -> Result<(), AuthError>;
    fn forget(&self) -> Result<(), AuthError>;
}

pub struct CredentialManagerVault {
    account: String,
}

impl CredentialManagerVault {
    fn entry(&self) -> Result<keyring::Entry, AuthError> {
        let service = if cfg!(debug_assertions) {
            "dev.veil.desktop.discord.development"
        } else {
            SERVICE
        };
        keyring::Entry::new(service, &self.account).map_err(|_| AuthError::Storage)
    }
}

impl TokenVault for CredentialManagerVault {
    fn load(&self) -> Result<Option<Tokens>, AuthError> {
        let encoded = match self.entry()?.get_password() {
            Ok(encoded) => encoded,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(AuthError::Storage),
        };
        // Bound retained input before parsing a damaged or foreign record.
        if encoded.len() > 24 * 1024 {
            return Err(AuthError::InvalidCredentials);
        }
        let record: Record =
            serde_json::from_str(&encoded).map_err(|_| AuthError::InvalidCredentials)?;
        if record.version != 1 {
            return Err(AuthError::InvalidCredentials);
        }
        record.tokens.validate()?;
        Ok(Some(record.tokens))
    }

    fn save(&self, tokens: &Tokens) -> Result<(), AuthError> {
        tokens.validate()?;
        let encoded = serde_json::to_string(&Record {
            version: 1,
            tokens: tokens.clone(),
        })
        .map_err(|_| AuthError::Storage)?;
        self.entry()?
            .set_password(&encoded)
            .map_err(|_| AuthError::Storage)
    }

    fn forget(&self) -> Result<(), AuthError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AuthError::Storage),
        }
    }
}

/// Debug acceptance clients never read a production credential. Multi-instance
/// profiles keep tokens only in their own process and always begin disconnected.
pub enum SessionVault {
    Persistent(CredentialManagerVault),
    Memory(std::cell::RefCell<Option<Tokens>>),
}

impl SessionVault {
    pub fn for_process() -> Self {
        if super::isolated_development() {
            return Self::Memory(std::cell::RefCell::new(None));
        }
        let account = if cfg!(debug_assertions) {
            use std::hash::{Hash, Hasher};
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            env!("CARGO_MANIFEST_DIR").hash(&mut hash);
            format!("{ACCOUNT}:{:x}", hash.finish())
        } else {
            ACCOUNT.to_owned()
        };
        Self::Persistent(CredentialManagerVault { account })
    }
}

impl TokenVault for SessionVault {
    fn load(&self) -> Result<Option<Tokens>, AuthError> {
        match self {
            Self::Persistent(vault) => vault.load(),
            Self::Memory(tokens) => Ok(tokens.borrow().clone()),
        }
    }
    fn save(&self, next: &Tokens) -> Result<(), AuthError> {
        match self {
            Self::Persistent(vault) => vault.save(next),
            Self::Memory(tokens) => {
                *tokens.borrow_mut() = Some(next.clone());
                Ok(())
            }
        }
    }
    fn forget(&self) -> Result<(), AuthError> {
        match self {
            Self::Persistent(vault) => vault.forget(),
            Self::Memory(tokens) => {
                *tokens.borrow_mut() = None;
                Ok(())
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Authorize,
    Refresh,
}

/// Kept native. The generation rejects late SDK callbacks after Cancel,
/// Disconnect, account replacement or a newer authorization attempt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attempt {
    generation: u64,
    operation: Operation,
}
impl Attempt {
    pub fn id(self) -> u64 {
        self.generation
    }
    pub fn is_refresh(self) -> bool {
        self.operation == Operation::Refresh
    }
}

pub struct Authorization<V: TokenVault> {
    vault: V,
    tokens: Option<Tokens>,
    active: Option<Attempt>,
    generation: u64,
}

impl<V: TokenVault> Authorization<V> {
    pub fn empty(vault: V) -> Self {
        Self {
            vault,
            tokens: None,
            active: None,
            generation: 0,
        }
    }
    /// Call only when a real SDK adapter is available and the user previously
    /// authorized the integration. A stored token is not proof of SDK Ready.
    pub fn restore(vault: V) -> Result<Self, AuthError> {
        let tokens = vault.load()?;
        if let Some(tokens) = &tokens {
            tokens.validate()?;
        }
        Ok(Self {
            vault,
            tokens,
            active: None,
            generation: 0,
        })
    }

    pub fn tokens(&self) -> Option<&Tokens> {
        self.tokens.as_ref()
    }

    pub fn begin(&mut self, operation: Operation) -> Result<Attempt, AuthError> {
        if self.active.is_some() {
            return Err(AuthError::Busy);
        }
        if operation == Operation::Refresh && self.tokens.is_none() {
            return Err(AuthError::ReconnectRequired);
        }
        self.generation += 1;
        let attempt = Attempt {
            generation: self.generation,
            operation,
        };
        self.active = Some(attempt);
        Ok(attempt)
    }

    pub fn complete(&mut self, attempt: Attempt, tokens: Tokens) -> Result<(), AuthError> {
        self.check(attempt)?;
        self.active = None;
        tokens.validate()?;
        // Rotation may already have invalidated the old refresh token. Retain
        // the newly issued pair in native memory even when durable storage
        // fails, and report the failure instead of claiming it was saved.
        let persisted = self.vault.save(&tokens);
        self.tokens = Some(tokens);
        persisted
    }

    pub fn cancel(&mut self, attempt: Attempt) -> Result<(), AuthError> {
        self.check(attempt)?;
        self.active = None;
        self.generation += 1;
        Ok(())
    }

    /// A transient network failure retains the previous credentials; only an
    /// actual invalid_grant/SDK unauthorized result should use this path.
    pub fn invalid_authorization(&mut self, attempt: Attempt) -> Result<(), AuthError> {
        self.check(attempt)?;
        self.disconnect()
    }

    pub fn disconnect(&mut self) -> Result<(), AuthError> {
        self.active = None;
        self.generation += 1;
        self.tokens = None;
        // Clear local memory even if the vault is unavailable, but return the
        // deletion error so the UI cannot claim saved tokens were removed.
        self.vault.forget()
    }

    fn check(&self, attempt: Attempt) -> Result<(), AuthError> {
        if self.active == Some(attempt) {
            Ok(())
        } else {
            Err(AuthError::StaleCallback)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    #[derive(Default, Clone)]
    struct Vault {
        tokens: Rc<RefCell<Option<Tokens>>>,
        fail_write: Rc<Cell<bool>>,
        fail_forget: Rc<Cell<bool>>,
    }

    impl TokenVault for Vault {
        fn load(&self) -> Result<Option<Tokens>, AuthError> {
            Ok(self.tokens.borrow().clone())
        }
        fn save(&self, tokens: &Tokens) -> Result<(), AuthError> {
            if self.fail_write.get() {
                return Err(AuthError::Storage);
            }
            *self.tokens.borrow_mut() = Some(tokens.clone());
            Ok(())
        }
        fn forget(&self) -> Result<(), AuthError> {
            if self.fail_forget.get() {
                return Err(AuthError::Storage);
            }
            *self.tokens.borrow_mut() = None;
            Ok(())
        }
    }

    fn grant(value: &str) -> Tokens {
        Tokens::from_grant(
            value.into(),
            format!("refresh-{value}"),
            3600,
            "openid sdk.social_layer_presence".into(),
            1000,
        )
        .ok()
        .unwrap()
    }

    #[test]
    fn refresh_is_serialized_and_rotation_is_saved_as_one_pair() {
        let vault = Vault::default();
        vault.save(&grant("old")).unwrap();
        let mut auth = Authorization::restore(vault.clone()).unwrap();
        let attempt = auth.begin(Operation::Refresh).unwrap();
        assert_eq!(auth.begin(Operation::Refresh), Err(AuthError::Busy));
        auth.complete(attempt, grant("new")).unwrap();
        let saved = vault.load().unwrap().unwrap();
        assert_eq!(saved.access_token(), "new");
        assert_eq!(saved.refresh_token(), "refresh-new");
    }

    #[test]
    fn cancelled_or_disconnected_attempt_cannot_restore_authorization() {
        let mut auth = Authorization::restore(Vault::default()).unwrap();
        let cancelled = auth.begin(Operation::Authorize).unwrap();
        auth.cancel(cancelled).unwrap();
        let current = auth.begin(Operation::Authorize).unwrap();
        assert_eq!(
            auth.complete(cancelled, grant("late")),
            Err(AuthError::StaleCallback)
        );
        auth.disconnect().unwrap();
        assert_eq!(
            auth.complete(current, grant("also-late")),
            Err(AuthError::StaleCallback)
        );
        assert!(auth.tokens().is_none());
    }

    #[test]
    fn failed_rotation_retains_new_pair_in_memory_but_reports_storage_failure() {
        let vault = Vault::default();
        vault.save(&grant("old")).unwrap();
        let mut auth = Authorization::restore(vault.clone()).unwrap();
        let attempt = auth.begin(Operation::Refresh).unwrap();
        vault.fail_write.set(true);
        assert_eq!(
            auth.complete(attempt, grant("new")),
            Err(AuthError::Storage)
        );
        assert_eq!(auth.tokens().unwrap().access_token(), "new");
        assert_eq!(
            vault.load().unwrap().unwrap().refresh_token(),
            "refresh-old"
        );
    }

    #[test]
    fn invalid_authorization_clears_tokens_without_a_provisional_fallback() {
        let vault = Vault::default();
        vault.save(&grant("old")).unwrap();
        let mut auth = Authorization::restore(vault.clone()).unwrap();
        let attempt = auth.begin(Operation::Refresh).unwrap();
        auth.invalid_authorization(attempt).unwrap();
        assert!(auth.tokens().is_none());
        assert!(vault.load().unwrap().is_none());
        assert_eq!(
            auth.begin(Operation::Refresh),
            Err(AuthError::ReconnectRequired)
        );
    }

    #[test]
    fn failed_forget_is_reported_but_memory_and_pending_work_are_cleared() {
        let vault = Vault::default();
        vault.save(&grant("old")).unwrap();
        let mut auth = Authorization::restore(vault.clone()).unwrap();
        let attempt = auth.begin(Operation::Refresh).unwrap();
        vault.fail_forget.set(true);
        assert_eq!(auth.disconnect(), Err(AuthError::Storage));
        assert!(auth.tokens().is_none());
        assert_eq!(
            auth.complete(attempt, grant("late")),
            Err(AuthError::StaleCallback)
        );
    }

    #[test]
    fn expiration_and_scope_checks_fail_closed() {
        let token = grant("value");
        assert!(!token.needs_refresh(4539));
        assert!(token.needs_refresh(4540));
        assert!(token.needs_refresh(u64::MAX));
        let missing =
            Tokens::from_grant("access".into(), "refresh".into(), 60, "openid".into(), 1000);
        assert!(matches!(missing, Err(AuthError::MissingScopes)));
    }

    #[test]
    fn ephemeral_vaults_start_empty_and_never_share_tokens() {
        let first = SessionVault::Memory(std::cell::RefCell::new(None));
        let second = SessionVault::Memory(std::cell::RefCell::new(None));
        first.save(&grant("first")).unwrap();
        second.save(&grant("second")).unwrap();
        first.forget().unwrap();
        assert!(first.load().unwrap().is_none());
        assert_eq!(second.load().unwrap().unwrap().access_token(), "second");
        let restarted = SessionVault::Memory(std::cell::RefCell::new(None));
        assert!(restarted.load().unwrap().is_none());
    }
}
