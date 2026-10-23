# Optional Discord connection and invites

## Current implementation status

**This is preparation for the Social SDK integration, not a working Discord
account-linking release.** The desktop still uses its existing text-only local IPC
Rich Presence publisher. It does not authenticate Discord accounts, read friends,
send Discord messages or activity invites, or receive SDK join callbacks.

The native preferences snapshot now explicitly reports account linking and activity
invites as unavailable. Settings displays this status separately from the existing
Rich Presence controls. Share offers a real **Copy link for Discord** action with
copying, copied and failure states; it never claims that a message was sent.
The direct-invites control stays off and disabled. No mock friend list or connected
profile is included in the production UI.

`apps/desktop/src/discord-invitations.ts` contains a pure invitation payload check
and session-only consent policy for the next slice. The policy has no transport
and is deliberately **not wired into the presence publisher** while SDK support is
unavailable. Merely constructing or reconciling the policy cannot enable sharing.
Its regression cases cover host-only consent, one selected document, invalidating
queued work after reset/stop/disconnect and the SDK payload boundary.

No OAuth command, provisional account, Veil identity service, token persistence,
SDK binaries, SDK headers, or speculative C++ bindings are added in this slice.

## Dependency that blocks the native integration

No authorized Discord Social SDK archive, `discordpp.h`/`cdiscord.h`, import library,
or `discord_partner_sdk.dll` was present in the workspace or the local Downloads
folder inspected during this task. There was no enabled browser session with which
to inspect the application's Developer Portal configuration. The documented C++
download is under the application's **Discord Social SDK > Downloads** page;
third-party mirrors are not a substitute for an authorized vendor download.

Before implementing or advertising native connection and direct invitations:

1. Confirm Social SDK eligibility for Veil's non-game desktop application. The
   existing Rich Presence application ID is `1562757675970863135`; confirm that
   application's SDK access rather than assuming its IPC activity proves access.
2. Obtain the official Windows x64 C++ SDK through the Developer Portal and record
   its version. Confirm how its headers, import libraries, runtime and notices may
   be handled in this public MIT repository, CI and installer. Keep vendor files
   outside Git until this is resolved.
3. Confirm the Discord application's **Public Client** configuration and desktop
   callback. The guide documents `http://127.0.0.1/callback` and SDK-owned redirect
   handling. Do not add a hosted redirect, client secret, or Veil account service.
4. Demonstrate local authorization using PKCE and only
   `openid sdk.social_layer_presence`, secure token storage, renewal and revocation.
5. With two real Discord accounts, prove an empty-message activity invite can be
   sent, accepted and round-tripped with these scopes. The guide's general
   prerequisite refers to communication scopes, but its detailed send section
   explicitly says presence-only invitations work with empty message content.
6. Prove activity invites remain joinable with `ActivityParty.MaxSize(0)`. The API
   documents zero as hiding the maximum; do not turn a Discord display requirement
   into an artificial Veil participant limit.

## Next app-side slice

Implement one Windows-native SDK owner and callback pump, isolated under
`apps/desktop/src-tauri/src/discord/`. Replace neither the existing publisher nor
its privacy behavior until the native spike succeeds; coordinate the two through
one publishing owner to avoid competing activities. Keep builds without the SDK
usable, with capabilities reporting unavailable.

Use the SDK's public-client `Authorize`, code-verifier, `GetToken`, `RefreshToken`
and `RevokeToken` paths. Keep codes/verifiers in native memory and tokens in a
separate Windows Credential Manager entry. Never return raw tokens to JavaScript
or store them in document, preferences or recovery data. On invalid authorization,
clear the connection and request reconnect; do not create provisional accounts.
Limit native commands to the main window and to explicit connection/invite
operations, with bounded queues, timeouts and sanitized error messages.

Replace the unavailable Settings card with cancelable authorization, connected
avatar/name/username, reconnect and disconnect states. Linking alone must never
start a session, adopt a guest name, publish an invitation or send anything.

Use `DiscordInvitationPolicy` as the session-only consent boundary after extending
the workspace controller with a host document's current sharing link. Opt-in
selects one joinable document. Switching tabs must not change that selection.
Reset/stop, session end, tab close, disconnect/account change and quit must clear
consent and invalidate queued sends; restarting/recovery must not restore it.
Before every send, check the selected generation, current session and connection.

Extend Share with the real SDK friend picker: searchable existing friends,
avatar fallback, clear identity, loading/empty/error states, per-person
Sending/Sent/Retry, and duplicate in-flight protection. Sent means accepted by
Discord, not delivered, read or joined. Clear the in-memory social graph on
disconnect; full chat/friend management is outside this feature's scope.

Register SDK join callbacks before `Connect`. The guide documents a 180-second
cold-launch pending-join window. Queue validated invitations until the workspace
is ready, deduplicate duplicate callbacks, and show Review/Dismiss before opening
the normal join flow in a new tab. Display the server and ask for explicit Join.
Preserve compatibility confirmation, host approval, cancellation and existing
admission errors. Test first-time/unlinked and expired-auth cold launches rather
than promising the SDK can deliver them without authorization.

Use existing components, light/dark semantic tokens, visible keyboard focus,
screen-reader status announcements, responsive layout, reduced motion and proper
focus restoration. Do not fetch remote avatars by broadly weakening the WebView
CSP; use bounded native retrieval or the appropriate narrowly scoped asset path.

## Existing protocol and deferred server work

No server contracts, admission/authentication, signaling, relay, capabilities,
invitation formats or peer protocols change in this slice. The server is not
edited or deployed. Server changes are explicitly deferred by the user.

The existing reusable link is `veil://join/<encoded-server-authority>/<22-char-code>`.
An official-server link is 58 ASCII characters and fits the SDK's 128-character
join-secret limit unchanged. The pure payload check accepts canonical production
short links only and never truncates. A longer custom-server link remains usable
through ordinary copy-link sharing. Reuse `joinShareLink`, short invitation lookup,
host approval and the existing reset/stop APIs; no new resolver is needed for
links that fit.

Turning off direct Discord invites will remove discovery/joinable presence and
stop new sends. It cannot revoke links already delivered. Those links work until
the existing link is reset, sharing stops or the host session ends. Already
approved guests retain their established connections according to current Veil
semantics. Any recipient-bound invitations, selective Discord-only revocation or
new resolver for arbitrary-length origins requires a separate server design and
is deferred, not advertised here.

The reviewed app compatibility generations are server `[2]` and peer `[1]`.
The server revision pinned in app integration CI is
`837d7e89c3c808418e02409323ff708a5647b447`; its compatibility implementation agrees.
Recheck current app/server compatibility when the transport slice is implemented.
No generation/version bump is needed for the current preparation work.

## Verification and remaining acceptance

The repository leaves ordinary feature testing to the user. Regression cases were
added but not run; no native OAuth, Discord invite, Windows installer or clean-machine
acceptance is claimed. Formatting and diff checks are recorded in the task handoff.

Once the SDK is available, exercise cancellation/denial, expired/revoked tokens,
Credential Manager failure, Discord closed/restarted, network failures/rate limits,
warm/cold launch, malformed/oversized links, duplicate callbacks, two concurrent
host tabs, reset/stop during an in-flight invite and both admission modes. Verify
actual packaging before considering this feature release-ready. Follow the normal
task worktree/PR workflow; this document does not authorize release or deployment.

## Official references

- [C++ SDK setup and runtime dependencies](https://docs.discord.com/developers/discord-social-sdk/getting-started/using-c%2B%2B)
- [Account linking and public-client token lifecycle](https://docs.discord.com/developers/discord-social-sdk/development-guides/account-linking-with-discord)
- [Scopes and public-client production cautions](https://docs.discord.com/developers/discord-social-sdk/core-concepts/oauth2-scopes)
- [Activity invite scopes, send and launch lifecycle](https://docs.discord.com/developers/discord-social-sdk/development-guides/managing-game-invites)
- [Join-secret bounds](https://discord.com/developers/docs/social-sdk/classdiscordpp_1_1ActivitySecrets.html)
- [Party size semantics](https://discord.com/developers/docs/social-sdk/classdiscordpp_1_1ActivityParty.html)
- [Social SDK terms and integrated distribution](https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms)
