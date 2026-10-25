# Optional Discord connection and invites

## Behavior

Veil can connect directly to Discord on Windows x64 using the Discord Social SDK.
There are no Veil accounts, provisional accounts, identity backend, bot, or hosted
OAuth redirect. Ordinary local documents, copy-link sharing and self-hosting do not
require Discord. Linking never starts sharing or publishes an invitation.

Settings > Sharing > Discord account offers connection, cancel, connected identity,
reconnect and disconnect states. Existing Rich Presence title/count preferences
remain separate. An unlinked user keeps the existing text-only presence path;
the worker stops that publisher before the SDK takes over publication.

The Share dialog has one invite link with one Copy button. Below it, one **Invite
Discord friends** row opens a friend view inside the same dialog. The row never
sends people to Settings. It can connect, reconnect or cancel authorization in
place. It is hidden in builds without the SDK. It is disabled, with the reason
shown, when a long self-hosted link cannot fit Discord's join secret; Copy still
works.

The dialog's **Privacy** section holds the per-document choices. **Who can join**
is anyone with the link, or only people the host approves; the latter can also be
chosen before the first link is created. When Discord is connected and ready,
**Joining from Discord** offers **Friends can join** (default; friends join without a host prompt) or **Invite only** (each Discord join request needs the host to let them in).

The two settings are independent where the server advertises `sharingChannels: 2`.
Discord invitations and join requests then carry a separate Discord link, registered
as the session's secondary sharing link. Guests arriving through it are admitted
without Veil's approval prompt, because Discord already gated them. Who can join
governs only the copied link. For example, Friends can join with Only people I
approve lets Discord friends in directly while link holders still ask. Reset link
replaces both links, and Stop sharing revokes both. On servers without the
capability, Discord uses the single shared link, Who can join also applies to
Discord friends, and the Share dialog says so. The Discord link is still a bearer
capability: a friend who extracts it could pass it on.
There is no separate on/off switch for invites: a connected host can always invite
friends to a shared document.

Discord activity points at one shared host document for the running app. It is
selected implicitly:

- when the active document starts sharing (or gets a new link) and nothing else
  is selected;
- when the host opens the friend view or changes Joining from Discord for a
  document.

Moving it from another document shows a note that earlier invites to that
document may stop working. Switching tabs alone does not move it. Reselecting the
same document and link keeps its consent generation, so readiness and sent states
survive. The selected document supplies presence title/count and its existing
reusable link.

Invite only publishes a private Discord party, so friends need an invite sent from
Veil. Discord may still offer its own "Ask to join" on a private party; Veil does
not act on those requests (live behavior unverified). Friends can join publishes a
public party. Per the SDK, a public party is joinable from the profile only as
the host's Discord account privacy settings allow (unverified live). Changing
this republishes the activity without invalidating the published join secret.
Admission through the Discord link does not use Who can join (see above).

Direct invitations require enabled Rich Presence and visible participant count.
The friend view explains this and offers an explicit **Turn on** for both. It
never changes these privacy preferences silently.

Friends load as follows:

- Discord pushes the friend list to the SDK after connect. The bridge reads
  `GetRelationships()` on Ready and immediately on relationship create/delete.
- User and presence updates are coalesced into at most one rescan every 2 seconds.
- Native code keeps the list, including each friend's reported status (online,
  idle, do not disturb, offline, or none), in an in-memory snapshot. The frontend
  polls the snapshot every 750 ms, and only changed versions return data.

The friend view searches by display name or username, ignoring case, width and
accents. It orders people invited during this connection first, then online,
idle, do-not-disturb and offline friends, each alphabetical. The order is fixed
when the list first appears, so presence changes don't move rows under the
pointer. Status shows as a dot on the avatar when Discord reports it. Whether the
`sdk.social_layer_presence` scope exposes friends' statuses still needs live
acceptance. The view renders the first 100 matches and asks the host to search
for the rest.

The list stays visible while Discord acknowledges the document's activity. Invite
clicks made before that acknowledgement wait up to 10 seconds, then report that
Discord is still getting ready. Per-person states cover sending, accepted send,
retry and explicit "Invite again". Sent means Discord accepted the request, not
delivered/read/joined. Title or participant-count updates for the same selected
link keep an acknowledged publication usable.

Avatars load lazily as rows scroll into view. Avatar requests are native,
constrained to SDK-provided Discord CDN URLs, size/time/concurrency bounded and
returned as raster data; the WebView CSP is unchanged. Native code keeps a
least-recently-used cache: 256 entries or 12 MB, keyed by person and avatar URL so
a changed avatar refetches. The frontend keeps up to 256 decoded avatars, keyed by
person and avatar revision, so reopening the list needs no IPC. Both caches, the
friend list and the invited-this-connection set stay in memory. They are cleared
on disconnect or account change.

There is no chat or friend-management interface. While sharing, the People panel
offers Copy link, a Discord shortcut into the friend view (when connected) and
Sharing options.

**Join a session** (the start screen card, tab menu and keybind formerly named
Join with a link) shows Discord sections above the link field. Without the SDK it
shows only the link field. When Discord is disconnected it offers Connect in
place. When connected it lists:

- **Invites for you:** pending invites from friends, each with Join.
- **Friends in Veil:** friends whose Discord activity for this application has a
  party. Each row shows the title if the host shares it, the participant count
  and the friend's status.

Joining a friend never needs a Veil account or extra server. The flow:

1. **Join** sends a Discord join request (`SendActivityJoinRequest`) for that
   friend's party.
2. The host's Veil receives it only for the party it currently publishes.
3. With **Friends can join**, the host's Veil answers automatically
   (`SendActivityJoinRequestReply`). With **Invite only**, the host sees
   "… wants to join “title” from Discord" with **Let in** / **Ignore**. Only one
   prompt per friend is kept; a newer request replaces the older one. A changed
   document, link or selection discards outstanding requests.
4. Letting someone in sends an ordinary Discord invite. The requester's Veil
   recognizes the answer to its own request (180-second window) and opens it
   without another prompt. If the requester has a saved name, Veil joins right
   away; otherwise the form asks for one.
5. The connection then follows the normal path. The link names the host's own
   server, so the guest needs no server setup. Admission (Who can join, approval
   prompts, compatibility checks) is unchanged.

Accepted invites from the hub join in the current tab, with the inviter shown on
the form. If the hub closes while a request is pending, the answer falls back to
the normal invite notification.

Limits needing live acceptance:

- The SDK documents that join requests require the target activity to "have
  space". Veil publishes a party maximum of 0 (hidden maximum). If Discord treats
  that as full, a display-only maximum would be needed; Veil itself still
  imposes no participant cap.
- Friends' party privacy is not exposed to other users, so every friend session
  shows the same Join action.
- Whether friends' Veil activities are visible under `sdk.social_layer_presence`
  is also unverified.

Incoming invitations show the inviter's avatar and name and offer Open/Dismiss.
Open obtains and validates the join payload, then opens the normal join form in a
new tab. The form shows "Invited by … on Discord" (memory only, dropped if the link
is edited) and the server, and asks for an explicit Join. In approval mode the
joining dialog says the guest is waiting for the host. It does not bypass host approval, compatibility checks,
guest names or existing admission errors. Repeated launch callbacks cannot silently
open duplicate tabs for the same invitation.

SDK invite-created events are filtered against the authenticated sender, validity,
join action and current party. SDK 1.10.19337's `ActivityInvite` has no recipient
field. Opaque party fingerprints correlate message and activity-join events; a
reviewed invitation cannot create a second generic notice. All workspace hosted
and opened invitation links suppress notices for those sessions, independent of
host/guest role. Invitations to other sessions remain available.

Link reset, stop, close/session end, loss of connection, account disconnect and quit
clear the selection and invalidate queued sends. The selection and Joining from
Discord choice are never persisted in Markdown, settings or recovery. Stopping
sharing, disconnecting Discord or turning off Discord status removes joinable
presence and blocks new sends. **Already delivered links remain usable until the existing link
is reset, sharing stops, or the host session ends.** Already connected guests keep
their authenticated connections under Veil's established semantics.

## Native boundary

`src-tauri/src/discord/sdk.cpp` is a Veil-owned C++20 bridge against Discord's
supplied public wrapper. The single Discord worker owns the SDK and callback pump;
SDK callbacks are registered before any connection. Native commands are limited
to the main window and explicit connection, document selection, friends, avatars
and invite operations. Queues, outstanding operations, snapshots, retries, images
and retained incoming invitations are bounded.

Authorization uses the SDK's PKCE verifier/challenge and public-client
`Authorize`/`GetToken` flow with only `openid sdk.social_layer_presence`. Outgoing
activity invites have empty message content, avoiding communication scopes. The
SDK handles its loopback callback and OAuth state validation. No client secret,
OAuth code, verifier, access token or refresh token reaches frontend JavaScript.

`auth.rs` stores rotated token pairs together in Windows Credential Manager under
`dev.veil.desktop.discord` / application ID. It has no token Debug formatting and
no Tauri command returning tokens. Token renewal is serialized; stale callbacks
after cancel/disconnect are rejected. Transient renewal failures retry within
bounds. Invalid authorization requires reconnect, with no provisional fallback.
If a rotated pair cannot be saved, native memory retains the newly issued pair
and the UI reports persistence failure. Disconnect clears local memory and the
vault, then production builds attempt Discord revocation; deletion or revocation failure is reported
instead of claiming all saved/remote authorization was removed.

Rich Presence updates are serialized/coalesced. New join secrets are not usable for
send until the SDK acknowledges publication. Every send rechecks document consent
and generation, current connection, publication, friendship and cooldown. Party
current size reflects participants; maximum is zero, which the SDK documents as
hiding a fixed maximum. Veil imposes no participant cap.

## Local SDK setup and builds

The owner supplied `DiscordSocialSdk-1.10.19337.zip` and confirmed via portal
screenshots that application `1562757675970863135` has Social SDK access, Public
Client enabled/saved, and `http://127.0.0.1/callback` registered. These prerequisites
are resolved; they are not continuing blockers.

From the task checkout, stage only the required Windows x64 assets:

```powershell
./scripts/install-discord-sdk.ps1 -Archive 'path/to/DiscordSocialSdk-1.10.19337.zip'
```

The script extracts the two headers, release import library/runtime and supplied
`License-Notices.txt` into ignored `.local/discord-social-sdk/`. Alternatively set
`VEIL_DISCORD_SDK_DIR` to an extracted SDK root. No vendor binaries, headers or full
archive are committed. The included notice file covers bundled open-source
components; Discord's separate Social SDK terms govern the SDK itself. Preserve
all notices and review the applicable terms when distributing an integrated build.

The native build discovers these assets, compiles the bridge and stages the runtime
and notices beside the executable. The existing Windows installer script adds
them as root resources when an SDK is present. It does not publish an installer.
Source builds without an SDK remain usable and report connection/invites
unavailable. Set `VEIL_DISCORD_SDK_DISABLED=1` to explicitly compile that fallback.
Do not omit the DLL from an installer built with SDK support.

Production startup registers the actual executable with Discord for cold invitation
launches. Debug builds do not replace that registration. The documented pending
cold-launch join window is 180 seconds.
Callback registration happens early; actual startup/expired-auth/first-link timing
still needs native acceptance.

Windows debug and release executables both use the GUI subsystem. A Discord cold
launch targets the executable directly, without a terminal wrapper or console
attachment; closing a console therefore cannot terminate a cold-launched Veil.
Development launchers can still capture inherited standard output/error streams.
`dev:multi` deliberately owns the processes it launches and stops them on Ctrl+C;
that explicit cleanup is separate from Discord cold launch. Old running clients
must be closed and `pnpm dev:multi` rerun to use a rebuilt executable.

## Independent development accounts

`pnpm dev:multi` starts every client disconnected. Each process keeps its own OAuth
tokens only in native memory; closing it discards them. It never reads, changes or
deletes production credentials. Other debug builds use a separate Credential Manager
service (`dev.veil.desktop.discord.development`) with a checkout-specific account
key. Production builds preserve normal saved-token restore. Debug disconnects do
not call Discord token revocation, because that can invalidate other authorizations
for the same application/user. They only clear their own local authorization.

Unlinked text-only presence is suppressed for isolated development clients, so
fresh windows do not compete for the current desktop Discord account. The debug-only
`VEIL_DISCORD_ALLOW_UNLINKED_PRESENCE=1` flag explicitly restores that behavior.
`VEIL_DISCORD_EPHEMERAL=1` also enables process-only tokens in a regular debug run.
These flags cannot change production credential behavior.

For two-account acceptance, connect one Veil window at a time. Choose account A in
the Discord authorization surface and confirm its avatar/name in Veil, then choose
account B before connecting the second window. If Discord desktop supplies the
authorization, switch its signed-in account between authorizations; if the SDK opens
a browser, use the intended signed-in browser account. Keep the first Veil client
running. Authorize sequentially to avoid competing loopback callback listeners.

SDK 1.10.19337 exposes no documented parameter selecting Stable/PTB/Canary, a browser
profile, or forcing an account picker in `AuthorizationArgs`. Veil does not claim
to route clients to different Discord installations. The separate device flow is
documented for limited-input devices and is not substituted for the requested
desktop PKCE flow. Two-account connection and simultaneous presence still require
live acceptance; isolated storage alone does not prove Discord routing behavior.

## Server compatibility and deferred work

This feature reuses `veil://join/<encoded-server-authority>/<22-character-code>` and
the existing short invitation resolve, host approval, compatibility and sharing
reset/stop APIs. The official-server payload is 58 ASCII characters, within the
SDK's 128-character limit. Neither frontend nor native code truncates links or
substitutes a legacy invitation. A custom origin that makes the payload too long
continues working through Copy link.

Separate Discord admission uses the additive secondary sharing link from
coordinated server PR ahmad-fatayerji/veil-server#14. `POST
/v3/sessions/:session/sharing` takes an optional `channel: "secondary"`, and
capabilities advertise `sharingChannels: 2`. The app sends `channel` only to
servers advertising the capability; otherwise it keeps one link. Signaling, relay,
invitation formats and peer negotiation are unchanged. Server and peer generations
remain `[2]` and `[1]`; the extension is capability-gated, like the earlier
sharing extensions. Deploy the server before relying on separate Discord admission.

App integration CI stays pinned to `837d7e89c3c808418e02409323ff708a5647b447`
until the server PR merges, so CI exercises the single-link fallback. Moving the
pin to the merged server revision is required before release. Recipient-bound
invites and a resolver for arbitrary-length origins are not promised here.

## Validation and acceptance limits

Task handoff records compilation, lint and formatting separately from execution.
Regression cases cover payload boundaries, one-document consent, stale work,
cancel/disconnect, refresh rotation/persistence and invalid authorization. Under
repository policy, local test suites and real user account flows are left to the
user unless execution is explicitly requested.

Real Windows/two-account acceptance remains necessary for consent denial/cancel,
saved credential restore, expiry/revocation, Credential Manager failure, Discord
closed/restarted, rate limiting, cold launch, concurrent tabs, reset/stop during a
send, long custom-server links, automatic/approval admission, actual zero-max party
invite behavior, avatar fallback, keyboard/screen-reader navigation and installer
resource placement. Compilation alone does not prove those behaviors. No merge,
release or deployment is authorized by this work. The requested remote review is a
draft PR; remaining native acceptance is not represented as complete.

## Official references

- [C++ setup and runtime dependencies](https://docs.discord.com/developers/discord-social-sdk/getting-started/using-c%2B%2B)
- [PKCE and public-client token lifecycle](https://docs.discord.com/developers/discord-social-sdk/development-guides/account-linking-with-discord)
- [Scopes and public-client guidance](https://docs.discord.com/developers/discord-social-sdk/core-concepts/oauth2-scopes)
- [Invites, presence-only messages and launch lifecycle](https://docs.discord.com/developers/discord-social-sdk/development-guides/managing-game-invites)
- [Join-secret bounds](https://discord.com/developers/docs/social-sdk/classdiscordpp_1_1ActivitySecrets.html)
- [Party size semantics](https://discord.com/developers/docs/social-sdk/classdiscordpp_1_1ActivityParty.html)
- [Social SDK terms](https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms)
