# OQ-44: Multi-device offline sync — scope and timing

- **Type:** OQ (product/business)
- **Status:** Open
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** High complexity · Low MVP urgency (excluded from MVP)
- **Related docs:** PB-BASELINE §10 (Offline Strategy), §15 (MVP), R-01; ADR-0004 (outbox); OQ-15; MVP proposal category C/E; roadmap Stage 7/9

## Context

Vardena's decided deployment model is a web app over the customer's LAN, with
single-user local operation supported and no mandatory internet for daily
operations (PB-BASELINE §10.1/§10.2 — DECIDED). The owner also described a
third capability: **multiple devices operating while disconnected from each
other or from the server, with later synchronization** (e.g. a salesman taking
orders on the road, a warehouse in a dead zone). The owner confirmed this is
desired *eventually* but did not decide its scope, timing, or architecture.

The repository has decided the opposite for MVP: single authoritative
PostgreSQL server, server-side sessions, no client-side data store. The
architecture.md "extraction path" and the outbox pattern (ADR-0004) solve
*external system* sync — not device-to-server offline sync, which is a
different problem (client-side store, conflict semantics, per-device identity,
security of local caches).

## Why this matters

- Sales teams may *assume* "offline ERP" means this capability; if it is
  silently expected, MVP expectations collide with its exclusion (risk R-01).
- It is one of the highest-complexity capabilities possible in this product
  (distributed data + conflict resolution + security) and could destabilize the
  whole ledger model if entered casually.
- The answer determines whether Sales ever designs a "mobile/field" flow and
  whether a client-side store ever enters the stack.

## Exact decision required

1. Which roles/documents (if any) must support disconnected multi-device
   operation, and in which business flows?
2. When (which release stage) is the earliest acceptable delivery?
3. Is the acceptable v1 compromise "server on LAN only, devices must be
   connected to the LAN" — with this OQ re-opened by market demand?

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Exclude indefinitely; re-open on demand** (LAN + single-user local only) | Zero cost now; protects ledger correctness; matches MVP scope | Field/mobile scenarios unsupported; lost deals if demand is real |
| **B. Narrow "field capture" sync** (offline capture of a few document types → queued, validated on reconnect; no true merge) | Bounded problem; reuses outbox-like queueing; useful for sales force | Still needs client store + identity + conflict policy; not trivial; doesn't generalize |
| **C. Full offline replication per device** (local DB per device, bidirectional sync with conflict resolution) | True offline ERP | Very high complexity; new architecture; conflicts corrupt accounting/inventory integrity; needs its own ADR program |

## Risks

- Option C undermines ledger immutability and single-source-of-truth invariants
  (AR-13, ADR-0017/0022) unless carefully designed.
- Promising this capability to customers before a decision exists (R-01).

## Dependencies

- Depends on real pilot-customer demand evidence (Stage 6+).
- Any option ≥ B requires an architecture ADR program (client store, sync
  protocol, conflict model, security) — none exists.

## Recommended option

**A for now, with B recorded as the likely future shape** if demand appears:
exclude from MVP and post-MVP stages until a named customer/deal requires it;
if re-opened, start with narrow field capture (B), never C directly.

## Questions requiring product owner confirmation

1. Do any of your expected first customers genuinely need disconnected
   multi-device operation in year one?
2. If yes: which flows (orders only? warehouse counts?) and which roles?
3. Do you accept recording this as "excluded until a named demand exists"?

## Decision deadline or dependency

No hard deadline; must be *revisited* at Stage 6 (pilot readiness) and before
any sales commitment. Blocks nothing in MVP.

## Related documents

PB-BASELINE §10.3, §15.3; MVP proposal (category C exclusion, category E);
roadmap Stage 7/9; ADR-0004; OQ-15 (sales→stock workflow), OQ-22 (branches).
