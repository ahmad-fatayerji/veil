use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use reqwest::{header::HeaderMap, Client, StatusCode, Url};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

pub const IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BYTES: u64 = 512 * 1024 * 1024;
const ATTEMPTS: u32 = 3;

#[derive(Debug, PartialEq)]
pub enum Failure {
    Cancelled,
    Interrupted,
    Http(u16),
    RateLimited(u64),
    TooLarge,
    Memory,
    Signature,
}
impl Failure {
    pub fn message(&self) -> String {
        match self {
            Self::Cancelled => "Update cancelled. Your installed version has not changed.".into(),
            Self::Interrupted => "The download stopped responding or the connection was interrupted after three attempts. Check your connection and retry. The update was not installed.".into(),
            Self::Http(404) => "The release download is no longer available. Check for updates again.".into(),
            Self::Http(code) => format!("The download server returned HTTP {code}. The update was not installed."),
            Self::RateLimited(_) => "GitHub is limiting download requests. Wait for the retry countdown before trying again. The update was not installed.".into(),
            Self::TooLarge => "The update exceeds the supported download size. The update was not installed.".into(),
            Self::Memory => "Not enough memory to download the update. Close other applications and retry. The update was not installed.".into(),
            Self::Signature => "The update failed signature or signed-version verification. It may be corrupted or the release may be misconfigured. The update was not installed. Check for updates before retrying.".into(),
        }
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn rate_limit_until(status: StatusCode, headers: &HeaderMap, now: u64) -> Option<u64> {
    let value = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let limited = status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN
            && (value("retry-after").is_some() || value("x-ratelimit-remaining") == Some("0")));
    if !limited {
        return None;
    }
    let retry = value("retry-after").and_then(|v| {
        v.parse::<u64>()
            .ok()
            .map(|seconds| now.saturating_add(seconds))
            .or_else(|| {
                httpdate::parse_http_date(v)
                    .ok()?
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .map(|v| v.as_secs())
            })
    });
    let reset = if value("x-ratelimit-remaining") == Some("0") {
        value("x-ratelimit-reset").and_then(|v| v.parse::<u64>().ok())
    } else {
        None
    };
    Some(
        retry
            .into_iter()
            .chain(reset)
            .max()
            .unwrap_or_else(|| now.saturating_add(60))
            .max(now.saturating_add(1)),
    )
}

// The timeout bounds each wait for bytes, not the duration of the whole download.
// Slow transfers may run as long as necessary while making progress.
pub async fn transfer(
    client: &Client,
    url: &Url,
    idle: Duration,
    mut cancel: watch::Receiver<bool>,
    mut progress: impl FnMut(u64, Option<u64>, u32, Option<u64>),
) -> Result<Vec<u8>, Failure> {
    for attempt in 1..=ATTEMPTS {
        if *cancel.borrow() {
            return Err(Failure::Cancelled);
        }
        progress(0, None, attempt, None);
        let result = tokio::select! {
            biased;
            _ = cancel.changed() => return Err(Failure::Cancelled),
            result = once(client, url, idle, &mut progress, attempt) => result,
        };
        match result {
            Ok(bytes) => return Ok(bytes),
            Err(Failure::Interrupted) | Err(Failure::Http(500..=599)) if attempt < ATTEMPTS => {
                let delay = 2u64.pow(attempt);
                progress(0, None, attempt, Some(now().saturating_add(delay)));
                tokio::select! {
                    biased;
                    _ = cancel.changed() => return Err(Failure::Cancelled),
                    _ = tokio::time::sleep(Duration::from_secs(delay)) => {},
                }
            }
            Err(error) => return Err(error),
        }
    }
    Err(Failure::Interrupted)
}

async fn once(
    client: &Client,
    url: &Url,
    idle: Duration,
    progress: &mut impl FnMut(u64, Option<u64>, u32, Option<u64>),
    attempt: u32,
) -> Result<Vec<u8>, Failure> {
    let mut response = tokio::time::timeout(
        idle,
        client
            .get(url.clone())
            .header("Accept", "application/octet-stream")
            .send(),
    )
    .await
    .map_err(|_| Failure::Interrupted)?
    .map_err(|_| Failure::Interrupted)?;
    if let Some(until) = rate_limit_until(response.status(), response.headers(), now()) {
        return Err(Failure::RateLimited(until));
    }
    if response.status() != StatusCode::OK {
        return Err(Failure::Http(response.status().as_u16()));
    }
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_BYTES) {
        return Err(Failure::TooLarge);
    }
    let mut bytes = Vec::new();
    progress(0, total, attempt, None);
    loop {
        let chunk = tokio::time::timeout(idle, response.chunk())
            .await
            .map_err(|_| Failure::Interrupted)?
            .map_err(|_| Failure::Interrupted)?;
        let Some(chunk) = chunk else {
            break;
        };
        if bytes.len() as u64 + chunk.len() as u64 > MAX_BYTES {
            return Err(Failure::TooLarge);
        }
        bytes
            .try_reserve(chunk.len())
            .map_err(|_| Failure::Memory)?;
        bytes.extend_from_slice(&chunk);
        progress(bytes.len() as u64, total, attempt, None);
    }
    if total.is_some_and(|size| size != bytes.len() as u64) {
        return Err(Failure::Interrupted);
    }
    Ok(bytes)
}

// Same minisign verification and signed-version policy as the pinned Tauri updater.
// Verification happens after transport retries and always before installer handoff.
pub fn verify(bytes: &[u8], signature: &str, key: &str, version: &str) -> Result<(), Failure> {
    let verify = || -> Option<()> {
        let key = STANDARD.decode(key).ok()?;
        let signature = STANDARD.decode(signature).ok()?;
        let key = PublicKey::decode(std::str::from_utf8(&key).ok()?).ok()?;
        let signature = Signature::decode(std::str::from_utf8(&signature).ok()?).ok()?;
        key.verify(bytes, &signature, true).ok()?;
        let signed = signature
            .trusted_comment()
            .split('\t')
            .find_map(|v| v.strip_prefix("version:"))?;
        let signed = semver::Version::parse(signed.trim_start_matches('v')).ok()?;
        let announced = semver::Version::parse(version.trim_start_matches('v')).ok()?;
        (signed == announced).then_some(())
    };
    verify().ok_or(Failure::Signature)
}

#[cfg(test)]
mod tests;
