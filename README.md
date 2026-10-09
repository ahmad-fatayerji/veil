# Veil

Windows desktop collaborative document overlay. This repository contains public installers, signed update metadata, release notes and test instructions. Source is maintained privately.

Download the latest Windows x64 setup EXE from [Releases](https://github.com/ahmad-fatayerji/veil/releases/latest). No development tools or GitHub account are needed. Both people install Veil, exchange an invitation and response privately, and edit the same document.

No default discovery service or relay is configured. Connections across NAT may require your own STUN/TURN server. Internet connectivity is not guaranteed. GitHub is used for distributing software, not for peer signaling or collaboration.

Open App updates to check for a new signed release. Update installation is blocked during an open session. Documents are temporary and are lost on ending/leaving/closing; copy text you want to keep. Local overlay preferences survive upgrades.

The Windows installer has no Authenticode publisher certificate, so unknown publisher warnings are possible. Updater signatures are separate and do not confer Windows publisher trust.

See TESTING.md attached to each release for setup, connection steps, known limits and useful bug reports. Never post invitation codes or credentials publicly.
