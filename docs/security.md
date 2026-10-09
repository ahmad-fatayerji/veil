# M0 security boundary

This is a local architectural spike. The loopback service checks Host and Origin on sensitive HTTP and WebSocket requests. Exact CORS origins avoid cross-site access; a random process credential is required before any document frames are transmitted. Bootstrap responses use `Cache-Control: no-store`; credentials are neither persisted nor logged, and are sent in the WebSocket subprotocol header instead of query strings.

These measures exclude arbitrary websites and accidental network exposure. They do not protect against malicious local processes, a compromised allowed dev frontend, or a compromised host. Any allowed local frontend can bootstrap; this is not host/guest authorization. Tauri has no custom commands and a constrained CSP. M0 rich text uses the editor schema; links are disabled, and imported raw HTML is not supported.

Frames are limited to 256 KiB, fan-out is bounded, stalled clients disconnect, and malformed/unsupported messages close the connection. Further security review must address awareness identity ownership, distinct message rate limits, authentication throttling, document size, admission under resource pressure, role enforcement, and token revocation before LAN/remote use. There is no numeric participant cap.

No claims of screen-capture exclusion are made. No secrets, signing keys, update endpoint, or public listener are configured.
