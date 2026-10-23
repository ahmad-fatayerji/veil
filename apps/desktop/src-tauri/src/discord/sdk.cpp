// Veil-owned bridge. Vendor headers/runtime stay outside the source repository.
#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <cmath>
#include <algorithm>
#include <chrono>

using Emit = void (*)(void*, int, uint64_t, uint64_t, int64_t, const char*, const char*, const char*);
constexpr uint64_t AppId = 1562757675970863135ULL;

struct Bridge {
    void* context;
    Emit callback;
    std::shared_ptr<bool> alive = std::make_shared<bool>(true);
    std::unique_ptr<discordpp::Client> client = std::make_unique<discordpp::Client>();
    uint64_t epoch = 0;
    uint64_t published = 0;
    uint64_t desired = 0;
    bool updating = false;
    bool dirty = false;
    bool enabled = false;
    bool urgent = true;
    int activity_failures = 0;
    std::chrono::steady_clock::time_point next_activity{};
    std::string published_link;
    bool friends_dirty = false;
    std::string details, state, link, party;
    int count = 1;
    std::unordered_map<uint64_t, discordpp::ActivityInvite> invitations;

    void emit(int kind, uint64_t request = 0, uint64_t id = 0, int64_t value = 0,
              std::string const& a = {}, std::string const& b = {}, std::string const& c = {}) {
        callback(context, kind, request, id, value, a.c_str(), b.c_str(), c.c_str());
    }
    int failure(discordpp::ClientResult const& result) {
        if (static_cast<int>(result.Status()) == 429) return 3;
        if (static_cast<int>(result.Status()) == 401 || result.Error().find("invalid_grant") != std::string::npos || result.ResponseBody().find("invalid_grant") != std::string::npos) return 1;
        return 0;
    }
    void user(int kind, discordpp::UserHandle const& person, uint64_t request = 0) {
        emit(kind, request, person.Id(), 0, person.DisplayName(), person.Username(),
             person.AvatarUrl(discordpp::UserHandle::AvatarType::Png, discordpp::UserHandle::AvatarType::Png));
    }
    void friends() {
        if (client->GetStatus() != discordpp::Client::Status::Ready) return;
        if (auto current = client->GetCurrentUserV2()) user(2, *current);
        emit(3);
        for (auto const& relationship : client->GetRelationships()) {
            if (relationship.DiscordRelationshipType() == discordpp::RelationshipType::Friend)
                if (auto person = relationship.User()) user(4, *person);
        }
        emit(5);
    }
    Bridge(void* ctx, Emit cb, bool register_launch) : context(ctx), callback(cb) {
        client->SetApplicationId(AppId);
        client->SetHttpRequestTimeout(10000);
        auto guard = alive;
        client->SetActivityJoinCallback([this, guard](std::string secret) {
            if (*guard) emit(11, 0, 0, 0, secret);
        });
        client->SetActivityInviteCreatedCallback([this, guard](discordpp::ActivityInvite invite) {
            if (!*guard || invite.ApplicationId() != AppId) return;
            auto key = invite.MessageId();
            if (invitations.size() >= 32) return;
            invitations.insert_or_assign(key, invite);
            if (auto person = client->GetUser(invite.SenderId())) user(10, *person, key);
            else emit(10, key, invite.SenderId(), 0, "Discord friend", "");
        });
        client->SetStatusChangedCallback([this, guard](auto status, auto, int32_t detail) {
            if (!*guard) return;
            if (detail == 4004) { emit(7, epoch, 0, 1); return; }
            emit(1, 0, 0, static_cast<int>(status));
            if (status == discordpp::Client::Status::Ready) { friends(); dirty = true; }
        });
        client->SetTokenExpirationCallback([this, guard]() { if (*guard) emit(13); });
        client->SetRelationshipCreatedCallback([this, guard](uint64_t, bool) { if (*guard) friends_dirty = true; });
        client->SetRelationshipDeletedCallback([this, guard](uint64_t, bool) { if (*guard) friends_dirty = true; });
        client->SetUserUpdatedCallback([this, guard](uint64_t) { if (*guard) friends_dirty = true; });
        // Empty command registers the actual executable, including paths with spaces.
        if (register_launch && !client->RegisterLaunchCommand(AppId, "")) emit(14);
    }
    ~Bridge() { *alive = false; client.reset(); }
    void token_callback(uint64_t attempt, discordpp::ClientResult result, std::string access,
                        std::string refresh, discordpp::AuthorizationTokenType, int32_t expires,
                        std::string scope) {
        if (attempt != epoch) return;
        if (!result.Successful()) { emit(7, attempt, 0, failure(result)); return; }
        emit(6, attempt, 0, expires, access, refresh, scope);
    }
    void authorize(uint64_t attempt) {
        epoch = attempt;
        auto verifier = client->CreateAuthorizationCodeVerifier();
        discordpp::AuthorizationArgs args;
        args.SetClientId(AppId);
        args.SetScopes(discordpp::Client::GetDefaultPresenceScopes());
        args.SetCodeChallenge(verifier.Challenge());
        auto guard = alive;
        client->Authorize(args, [this, guard, verifier, attempt](auto result, std::string code, std::string redirect) {
            if (!*guard || epoch != attempt) return;
            if (!result.Successful()) { emit(7, attempt, 0, failure(result)); return; }
            client->GetToken(AppId, code, verifier.Verifier(), redirect,
                [this, guard, attempt](auto result, auto access, auto refresh, auto type, auto expires, auto scope) {
                    if (*guard) token_callback(attempt, result, access, refresh, type, expires, scope);
                });
        });
    }
    void refresh(uint64_t attempt, std::string token) {
        epoch = attempt;
        auto guard = alive;
        client->RefreshToken(AppId, token, [this, guard, attempt](auto result, auto access, auto refresh, auto type, auto expires, auto scope) {
            if (*guard) token_callback(attempt, result, access, refresh, type, expires, scope);
        });
    }
    void connect(std::string token, bool preserve_ready) {
        if (!preserve_ready && client->GetStatus() != discordpp::Client::Status::Disconnected) client->Disconnect();
        auto guard = alive;
        auto attempt = epoch;
        client->UpdateToken(discordpp::AuthorizationTokenType::Bearer, token, [this, guard, attempt, preserve_ready](auto result) {
            if (!*guard || attempt != epoch) return;
            if (result.Successful()) {
                if (preserve_ready && client->GetStatus() == discordpp::Client::Status::Ready) { emit(1, 0, 0, 3); friends(); }
                else client->Connect();
            }
            else if (!result.Successful()) emit(7, attempt, 0, failure(result));
        });
    }
    void pump() {
        discordpp::RunCallbacks();
        if (friends_dirty && client->GetStatus() == discordpp::Client::Status::Ready) { friends_dirty = false; friends(); }
        if (!dirty || updating || (!urgent && std::chrono::steady_clock::now() < next_activity) || client->GetStatus() != discordpp::Client::Status::Ready) return;
        dirty = false;
        urgent = false;
        next_activity = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        published = 0;
        if (!enabled) { client->ClearRichPresence(); return; }
        discordpp::Activity activity;
        activity.SetType(discordpp::ActivityTypes::Playing);
        activity.SetDetails(details);
        if (!state.empty()) activity.SetState(state);
        if (!link.empty()) {
            discordpp::ActivityParty group;
            group.SetId(party);
            group.SetCurrentSize(count);
            group.SetMaxSize(0);
            group.SetPrivacy(discordpp::ActivityPartyPrivacy::Private);
            activity.SetParty(group);
            discordpp::ActivitySecrets secrets;
            secrets.SetJoin(link);
            activity.SetSecrets(secrets);
            activity.SetSupportedPlatforms(discordpp::ActivityGamePlatforms::Desktop);
        }
        updating = true;
        auto version = desired;
        auto secret = link;
        auto guard = alive;
        client->UpdateRichPresence(activity, [this, guard, version, secret](auto result) {
            if (!*guard) return;
            updating = false;
            if (result.Successful()) {
                activity_failures = 0;
                if (secret == link && enabled) published_link = secret;
                if (version == desired) published = version;
            } else if (++activity_failures <= 3) { dirty = true; }
            emit(8, version, 0, result.Successful());
        });
    }
};

extern "C" {
void* veil_discord_create(void* context, Emit emit, bool register_launch) { try { return new Bridge(context, emit, register_launch); } catch (...) { return nullptr; } }
void veil_discord_destroy(Bridge* bridge) { delete bridge; }
void veil_discord_pump(Bridge* bridge) { bridge->pump(); }
void veil_discord_authorize(Bridge* bridge, uint64_t attempt) { bridge->authorize(attempt); }
void veil_discord_refresh(Bridge* bridge, uint64_t attempt, char const* token) { bridge->refresh(attempt, token); }
void veil_discord_connect(Bridge* bridge, char const* token, bool preserve_ready) { bridge->connect(token, preserve_ready); }
void veil_discord_cancel(Bridge* bridge) { ++bridge->epoch; bridge->client->AbortAuthorize(); }
void veil_discord_pause(Bridge* bridge) { ++bridge->epoch; bridge->published = 0; bridge->client->AbortAuthorize(); bridge->client->ClearRichPresence(); bridge->client->Disconnect(); }
void veil_discord_disconnect(Bridge* bridge, char const* token) {
    ++bridge->epoch;
    bridge->published = 0;
    bridge->published_link.clear();
    bridge->dirty = false;
    bridge->client->AbortAuthorize();
    bridge->client->ClearRichPresence();
    bridge->client->Disconnect();
    bridge->invitations.clear();
    if (!token || !*token) { bridge->emit(12, 0, 0, 1); return; }
    auto guard = bridge->alive;
    bridge->client->RevokeToken(AppId, token, [bridge, guard](auto result) {
        if (*guard) bridge->emit(12, 0, 0, result.Successful());
    });
}
void veil_discord_friends(Bridge* bridge) { bridge->friends(); }
void veil_discord_activity(Bridge* bridge, uint64_t generation, bool enabled, char const* details,
                           char const* state, char const* link, char const* party, int count) {
    if (bridge->link != link || bridge->enabled != enabled) {
        bridge->urgent = true; bridge->activity_failures = 0; bridge->published_link.clear();
    }
    if (!enabled || (!bridge->link.empty() && !*link)) bridge->client->ClearRichPresence();
    bridge->desired = generation;
    bridge->published = 0;
    bridge->enabled = enabled;
    bridge->details = details; bridge->state = state; bridge->link = link; bridge->party = party;
    bridge->count = count;
    bridge->dirty = true;
}
void veil_discord_send(Bridge* bridge, uint64_t request, uint64_t user, uint64_t generation) {
    if (!generation || bridge->published_link != bridge->link || !bridge->enabled || bridge->link.empty() || bridge->client->GetStatus() != discordpp::Client::Status::Ready) {
        bridge->emit(9, request, 0, 4); return;
    }
    if (bridge->client->GetRelationshipHandle(user).DiscordRelationshipType() != discordpp::RelationshipType::Friend) { bridge->emit(9, request, 0, 2); return; }
    auto guard = bridge->alive;
    bridge->client->SendActivityInvite(user, "", [bridge, guard, request](auto result) {
        if (*guard) bridge->emit(9, request, static_cast<uint64_t>(std::ceil(std::max(0.0f, result.RetryAfter()))), result.Successful() ? -1 : bridge->failure(result));
    });
}
void veil_discord_accept(Bridge* bridge, uint64_t request, uint64_t invite) {
    auto found = bridge->invitations.find(invite);
    if (found == bridge->invitations.end()) { bridge->emit(15, request); return; }
    auto item = found->second;
    auto guard = bridge->alive;
    bridge->client->AcceptActivityInvite(item, [bridge, guard, request, invite](auto result, std::string secret) {
        if (*guard) { if (result.Successful()) bridge->invitations.erase(invite); bridge->emit(15, request, 0, result.Successful(), secret); }
    });
}
void veil_discord_dismiss(Bridge* bridge, uint64_t invite) { bridge->invitations.erase(invite); }
}
