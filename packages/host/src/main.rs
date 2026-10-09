#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:4444").await?;
    println!("Veil M0 host listening on 127.0.0.1:4444 (loopback only; in-memory document)");
    axum::serve(listener, veil_host::demo_router())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
