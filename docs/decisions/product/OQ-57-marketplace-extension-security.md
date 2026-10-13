# OQ-57: Marketplace & third-party extension security

- **Type:** OQ (deferred — product/platform decision)
- **Status:** Open — **deliberately deferred** (premature to finalize)
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** Low · Post-MVP · Must not consume near-term attention
- **Related docs:** PB-BASELINE §27, PD-34; ADR-0029 (machine API access — the plausible first ecosystem shape); OQ-50 (webhooks); architecture.md §12 (extraction path); roadmap post-MVP

## Context

The baseline records an ecosystem vision (third-party modules, signed
extensions, API-based extensions, marketplace possibility, extension approval,
database access policy) as **directional/future**, and explicitly states the
unresolved security policies (sandboxing, capability model, revocation,
liability) must **not** be finalized now (PB-BASELINE §27).

This OQ exists so the *deferral itself is governed*: it records what is known,
what is decided-adjacent, and the trigger conditions for reopening — so no one
invents marketplace policy silently.

Adjacent decided facts it must respect:

- **No third-party database access** is granted under any current decision
  (PB-BASELINE §27).
- API-based extensions (external services over the licensed API) are the most
  plausible first shape — ADR-0029's machine-access model covers exactly this.
- In-process code extensions would interact with the modular-monolith
  architecture (new modules = ADR per AR-29) and would need signing/trust —
  deliberately not designed.

## Why this matters

- Premature marketplace policy either blocks a future ecosystem (too strict)
  or creates a security hole (too loose) before there is anything to secure.
- If a partner approaches early, the *process* for handling it should exist
  even though the policy doesn't.

## Exact decision required (when re-opened)

1. Extension model: API-only (external services) vs in-process modules vs both.
2. Trust model: signing, review process, approval authority, revocation.
3. Customer-side consent and control (what a customer-admin can allow).
4. Commercial model (revenue share, listing, certification).
5. Liability and support boundaries.

## Options (recorded as future shapes, not decisions)

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. API-only ecosystem** (external services via licensed API + webhooks) | No in-process trust problem; uses ADR-0029/0004; safest | Less deep integration than native modules |
| **B. Signed native extensions** (in-process modules with signature + review) | Deep integration; marketplace-grade | Major security/ADR program; requires runtime trust design |
| **C. Curated first-party modules only** (no third-party code) | Simplest trust story | Not a marketplace |

## Risks

- Ad-hoc partner deals slipping in-process code before any trust model exists —
  the real risk this OQ guards against.

## Dependencies

- ADR-0029 (machine access), OQ-50 (webhooks), AR-29 (any new module = ADR).
- Demand evidence: a real partner/customer requirement is the trigger.

## Recommended option

**A when the ecosystem first becomes real; B only after a dedicated ADR
program; C remains the default until there is demand.** No policy is decided
here by design. **Recommendation only.**

## Questions requiring product owner confirmation

1. Do you want an ecosystem at all, or curated first-party modules forever?
2. If a partner approaches before policy exists: is the interim rule "API-based
   integration only, no in-process code"?

## Decision deadline or dependency

No deadline. Re-open on: first partner demand, or Stage 8+ commercial
planning.

## Related documents

PB-BASELINE §27; ADR-0029; OQ-50; architecture.md §12; roadmap post-MVP.
