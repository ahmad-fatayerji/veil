# Veil repository rules

- Follow PROJECT_SPEC.md and implement one milestone at a time. Current milestone: M6 (installer, updater, release), advanced at the user's request for P2P testing.
- Keep Windows-first native code isolated from shared React packages.
- Participant capacity defaults to no application-level cap.
- Never expose a public unauthenticated service; M0 listens on loopback only.
- Do not claim universal capture exclusion.
- Keep builds and tests passing. Document unverified native behavior honestly.
