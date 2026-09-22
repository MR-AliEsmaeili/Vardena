# ADR-0030: License foundation — minimal, non-punitive, enforcement-off

- **Status:** Proposed (pending product-owner ratification — not Accepted)
- **Date:** 2026-09-22
- **Decision owner:** Ali Esmaeili (product/commercial) + architecture (technical shape)
- **Product sources:** PB-BASELINE §11 (commercial model), §15.2 (license foundation as MVP platform capability), PD-08/PD-09/PD-12
- **Related OQs:** OQ-45 (expiry behavior — deliberately NOT decided here), OQ-52/OQ-53 (restore never blocked), OQ-46 (export never blocked)
- **Builds on:** ADR-0002 (stack), ADR-0008 (schema per module), ADR-0025 (single-organization deployment pin), AR-21 (backend enforcement), security.md §6 (secrets)

## Context

The commercial structure is decided (setup fee + base license + support
subscription + modules + custom development; modules sellable separately;
API/licensing-gated capabilities per PD-35). Licensing is a decided **MVP
platform capability** (PD-17: "License foundation"). But two things are
explicitly undecided: the *enforcement mechanism details* (PD-08) and the
*expiry behavior* (PD-09/OQ-45 — including during internet outages). Building
punitive enforcement before OQ-45 resolves would bake in behavior the owner
hasn't chosen (risk R-02).

## Problem statement

What is the *minimum* in-product licensing capability the MVP must contain —
recorded honestly as a foundation — such that (a) the MVP capability list is
satisfied, (b) later enforcement (post-OQ-45) needs no re-architecture, and
(c) no customer-visible blocking behavior exists before the owner decides it?

## Decision drivers

1. License state must be **recorded in-product** (module enablement, editions,
   term dates) to ground module gating and future enforcement.
2. **Non-punitive by default**: nothing in the MVP may block, degrade, or
   time-bomb a working installation. Expiry behavior is OQ-45.
3. Offline-first: any future validation must work without internet
   (PB §10.1); no online-only license checks.
4. Tamper-resistance proportionate to on-premise reality: the customer controls
   the machine; the goal is honest-record + operational friction, not DRM
   perfection.
5. Restore/export must never be license-blocked (OQ-45/OQ-52/OQ-53 interplay).

## Considered options & trade-offs

| Option | Trade-offs |
|---|---|
| **A. Foundation-only: license record + module enablement, enforcement-off** *(recommended)* | Satisfies MVP capability list; zero customer risk; preserves all future options. Provides no revenue protection until enforcement is decided. |
| B. Foundation + offline-signed license file enforcement now | Revenue protection early; but bakes in expiry behavior before OQ-45; signing infra (key management, per-customer keys) is real work. |
| C. Online license validation service | Strongest control; contradicts the offline/no-mandatory-internet principle; needs internet infra the product explicitly doesn't require. |

## Recommended decision

**Option A — ship the foundation, defer enforcement:**

1. **License record** (new `license` schema or `core`-adjacent table — owning
   module decided at implementation): licensee name, license id, edition,
   enabled modules/capabilities (Inventory, Sales, Accounting, Report Builder,
   API access per ADR-0029), issued-at, valid-from, valid-to, support-term
   end, raw license payload.
2. **Read APIs + admin UI** to view license state; **module enablement reads
   the license** so unlicensed modules are hidden (UX-level gating only —
   backend permission enforcement stays AR-21 as-is).
3. **No expiry enforcement**: `valid_to` is recorded and *displayed* (warning
   banner after expiry is acceptable) — no lockout, no feature time-bomb,
   no read-only flips. All enforcement semantics are OQ-45's to decide.
4. **License payload format** (signed file, verification keys) is designed but
   *implementation is deferred* to the enforcement task; the record schema
   stores the payload verbatim so signed licenses can be introduced without
   migration pain.
5. **Operator-settable**: initial licenses are installed by the operator
   (controlled install process, PB §9/§24) — no self-service license entry.

## Consequences

**Security implications.** License payload handling must treat it as
untrusted input until verified; when signing lands, key management follows
security.md §6 (config-provided, never committed). Displaying license data
requires no new sensitive-data exposure.

**Data implications.** One new table + additive migration at implementation;
module-enablement joins read it; no existing schema changes.

**Operational implications.** Controlled-install runbook gains a "install
license" step; support workflows can read license state for diagnostics;
backup/restore carries license data (restore never blocked — OQ-53 rule).

**Migration implications.** Additive only; enforcement task (post-OQ-45) may
add verification keys/config — no destructive change expected.

## Rejected alternatives

Enforcement-now (B: preempts OQ-45; risk R-02), online validation (C:
contradicts offline principle), no license record at all (fails decided MVP
platform capability PD-17).

## Open follow-up items

1. **OQ-45** must decide expiry/termination behavior before any enforcement
   code (Stage 8 gate).
2. Owning module for the license schema (new `licensing` module vs
   `organization`-adjacent) — small implementation ADR/note.
3. Signed-license format design (deferred with enforcement).
4. Owner ratification — **Proposed, not Accepted.**

## Related documents

PB-BASELINE §11, §15.2, §17; OQ-45, OQ-46, OQ-52, OQ-53; ADR-0025, ADR-0029;
roadmap Stage 0 (ratify) / Stage 1 (implement foundation).
