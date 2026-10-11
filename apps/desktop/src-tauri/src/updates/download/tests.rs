use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
};

// Real local sockets with controlled bodies; only unit tests permit HTTP.
type Response = (String, Vec<(Duration, Vec<u8>)>);
fn server(responses: Vec<Response>) -> (Url, Arc<AtomicUsize>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = Url::parse(&format!(
        "http://{}/installer",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let count = requests.clone();
    let handle = thread::spawn(move || {
        for (headers, chunks) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).unwrap() > 0);
            count.fetch_add(1, Ordering::SeqCst);
            if stream.write_all(headers.as_bytes()).is_err() {
                continue;
            }
            for (delay, chunk) in chunks {
                thread::sleep(delay);
                if stream.write_all(&chunk).is_err() {
                    break;
                }
            }
        }
    });
    (url, requests, handle)
}
fn client() -> Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder().no_proxy().build().unwrap()
}
fn headers(size: usize) -> String {
    format!("HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n")
}

#[tokio::test]
async fn slow_progressing_download_outlives_idle_timeout_and_reports_size() {
    let (url, count, handle) = server(vec![(
        headers(4),
        (0..4)
            .map(|_| (Duration::from_millis(40), vec![b'x']))
            .collect(),
    )]);
    let (_sender, cancel) = watch::channel(false);
    let mut last = (0, None);
    let bytes = transfer(
        &client(),
        &url,
        Duration::from_millis(100),
        cancel,
        |n, total, _, _| last = (n, total),
    )
    .await
    .unwrap();
    assert_eq!(bytes, b"xxxx");
    assert_eq!(last, (4, Some(4)));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    handle.join().unwrap();
}

#[tokio::test]
async fn interrupted_response_retries_from_zero_and_never_appends_partial_bytes() {
    let (url, count, handle) = server(vec![
        (headers(4), vec![(Duration::ZERO, b"xx".to_vec())]),
        (headers(4), vec![(Duration::ZERO, b"good".to_vec())]),
    ]);
    let (_sender, cancel) = watch::channel(false);
    let bytes = transfer(
        &client(),
        &url,
        Duration::from_secs(1),
        cancel,
        |_, _, _, _| {},
    )
    .await
    .unwrap();
    assert_eq!(bytes, b"good");
    assert_eq!(count.load(Ordering::SeqCst), 2);
    handle.join().unwrap();
}

#[tokio::test]
async fn stalled_download_exhausts_three_attempts() {
    let (url, count, handle) = server(
        (0..3)
            .map(|_| {
                (
                    headers(4),
                    vec![(Duration::from_millis(100), b"good".to_vec())],
                )
            })
            .collect(),
    );
    let (_sender, cancel) = watch::channel(false);
    assert_eq!(
        transfer(
            &client(),
            &url,
            Duration::from_millis(40),
            cancel,
            |_, _, _, _| {}
        )
        .await,
        Err(Failure::Interrupted)
    );
    assert_eq!(count.load(Ordering::SeqCst), 3);
    handle.join().unwrap();
}

#[tokio::test]
async fn throttling_never_retries_before_server_deadline() {
    let (url, count, handle) = server(vec![("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 120\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(), vec![])]);
    let (_sender, cancel) = watch::channel(false);
    let before = now();
    let result = transfer(
        &client(),
        &url,
        Duration::from_secs(1),
        cancel,
        |_, _, _, _| {},
    )
    .await;
    assert!(matches!(result, Err(Failure::RateLimited(until)) if until >= before + 120));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    handle.join().unwrap();
}

#[tokio::test]
async fn cancellation_interrupts_waiting_for_bytes_without_retry() {
    let (url, count, handle) = server(vec![(
        headers(4),
        vec![(Duration::from_millis(200), b"good".to_vec())],
    )]);
    let (sender, cancel) = watch::channel(false);
    let cancellation = async {
        tokio::time::sleep(Duration::from_millis(30)).await;
        sender.send(true).unwrap();
    };
    let client = client();
    let (result, _) = tokio::join!(
        transfer(
            &client,
            &url,
            Duration::from_secs(1),
            cancel,
            |_, _, _, _| {}
        ),
        cancellation
    );
    assert_eq!(result, Err(Failure::Cancelled));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    handle.join().unwrap();
}

#[test]
fn rate_headers_accept_dates_and_resets_without_treating_all_403_as_throttling() {
    let mut headers = HeaderMap::new();
    assert_eq!(rate_limit_until(StatusCode::FORBIDDEN, &headers, 100), None);
    assert_eq!(
        rate_limit_until(StatusCode::TOO_MANY_REQUESTS, &headers, 100),
        Some(160)
    );
    headers.insert(
        "retry-after",
        "Thu, 01 Jan 1970 00:03:20 GMT".parse().unwrap(),
    );
    assert_eq!(
        rate_limit_until(StatusCode::TOO_MANY_REQUESTS, &headers, 100),
        Some(200)
    );
    headers.insert("x-ratelimit-remaining", "0".parse().unwrap());
    headers.insert("x-ratelimit-reset", "300".parse().unwrap());
    assert_eq!(
        rate_limit_until(StatusCode::FORBIDDEN, &headers, 100),
        Some(300)
    );
}

#[tokio::test]
async fn unknown_length_reports_bytes_and_permanent_errors_do_not_retry() {
    let (url, count, handle) = server(vec![(
        "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".into(),
        vec![(Duration::ZERO, b"good".to_vec())],
    )]);
    let (_sender, cancel) = watch::channel(false);
    let mut last = (0, Some(0));
    assert_eq!(
        transfer(
            &client(),
            &url,
            Duration::from_secs(1),
            cancel,
            |n, total, _, _| last = (n, total)
        )
        .await
        .unwrap(),
        b"good"
    );
    assert_eq!(last, (4, None));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    handle.join().unwrap();
    let (url, count, handle) = server(vec![(
        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        vec![],
    )]);
    let (_sender, cancel) = watch::channel(false);
    assert_eq!(
        transfer(
            &client(),
            &url,
            Duration::from_secs(1),
            cancel,
            |_, _, _, _| {}
        )
        .await,
        Err(Failure::Http(404))
    );
    assert_eq!(count.load(Ordering::SeqCst), 1);
    handle.join().unwrap();
}

#[test]
#[ignore = "Requires VEIL_TEST_INSTALLER to point to a signed packaged installer"]
fn real_package_verification_rejects_tampering_truncation_and_wrong_version() {
    let installer = std::env::var("VEIL_TEST_INSTALLER").unwrap();
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    let key = config["plugins"]["updater"]["pubkey"].as_str().unwrap();
    let signature = std::fs::read_to_string(format!("{installer}.sig")).unwrap();
    let mut bytes = std::fs::read(installer).unwrap();
    let version = config["version"].as_str().unwrap();
    assert!(verify(&bytes, signature.trim(), key, version).is_ok());
    assert_eq!(
        verify(&bytes, signature.trim(), key, "999.0.0"),
        Err(Failure::Signature)
    );
    assert_eq!(
        verify(&bytes[..bytes.len() / 2], signature.trim(), key, version),
        Err(Failure::Signature)
    );
    bytes[0] ^= 1;
    assert_eq!(
        verify(&bytes, signature.trim(), key, version),
        Err(Failure::Signature)
    );
}
