# NEXUS PROXIMITY VOICE — SAFE ARCHITECTURE (flag nexus_voice = OFF, not shipped)

STATUS: Foundation designed; NOT enabled. Blocking dependency: no production-capable SFU is
configured in this stack, and purchasing/deploying new voice infrastructure requires founder
authorization (per directive). P2P mesh rejected (unbounded for crowds).

## Required flow before flag can turn ON (all must be functional)
1. Explicit mic permission prompt (getUserMedia audio only) — only after user taps mic.
2. Muted-by-default entry; persistent muted/live indicator in HUD (Mic icon states).
3. Signaling: reuse presence channel — extend /api/nexus/presence body with voice:{muted, speaking};
   peers list already scoped per instance+zone → proximity routing = filter peers within 12u.
4. Media: SFU (e.g. LiveKit/mediasoup) — NOT provisioned. Adapter interface:
   services/voice_provider.py {create_room(instance_id), token(user, room), close_room} (to build
   when infra approved).
5. Safety: user mute/block/report per speaker; teens (13-17) voice unavailable (age gate already
   blocks <13 platform-wide); guardian permission required for any future teen voice.
6. No recording/transcription by default; disclosure required before any future recording.
7. Cleanup: mic tracks stopped on EXIT/back/disconnect/instance transfer (tie into exitWorld()).
8. Abuse: server rate limits on voice state changes; room capped to instance capacity.
