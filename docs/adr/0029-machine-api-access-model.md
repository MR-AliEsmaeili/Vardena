# ADR-0029: Machine/API access model — licensed API keys on the RBAC permission model

- **Status:** Proposed (pending product-owner ratification — not Accepted)
- **Date:** 2026-09-22
- **Decision owner:** Ali Esmaeili (product/commercial) + architecture (technical shape)
- **Product sources:** PB-BASELINE §28 (API & Integration Strategy), PD-35/PD-36
- **Related OQs:** OQ-50 (webhooks), OQ-58 (public release posture)
- **Builds on:** ADR-0006/0016 (RBAC), ADR-0007 (sessions), ADR-0014 (OpenAPI contract), ADR-0004 (outbox), AR-21/AR-22

## Context

Vardena's API strategy (PD-35): API access beyond the product UI is a **licensed
capability**, enabled per installation, using the existing granular permission
model, with configurable rate limits. The UI authenticates via server-side
opaque sessions (ADR-0007) — designed for interactive browsers, not for
machine-to-machine callers (integration scripts, customer ERP-to-ERP bridges,
future webhook consumers). No machine-access mechanism exists today.

## Problem statement

How do non-interactive clients authenticate and authorize against the Vardena
API without weakening the session model, without inventing a parallel
permission system, and without committing to mechanisms (OAuth2, public API
program) the product does not need yet?

## Decision drivers

1. Licensed per installation; activatable via licensing (PD-35) — no API access
   unless the license grants it.
2. Reuse RBAC permission codes as the only authorization surface (AR-21/22) —
   no ambient "API role", no separate scope language in v1.
3. Revocable and auditable per credential (server-side state, like sessions).
4. Compatible with on-premise/offline operation (no external auth provider).
5. Minimal implementation surface for MVP/post-MVP; OAuth2 deferred.

## Considered options & trade-offs

| Option                                                       | Trade-offs                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. API keys bound to a machine principal** _(recommended)_ | Simple, revocable, auditable; maps cleanly onto users→roles→permissions (machine principal holds roles); offline-safe. Weaker than mTLS/OAuth2 for high-security scenarios — acceptable for on-premise LAN. |
| B. JWT-based machine tokens                                  | Stateless but loses server-side revocation (the exact reason ADR-0007 rejected JWT for users); token expiry semantics awkward offline.                                                                      |
| C. OAuth2 client-credentials now                             | Standards-rich; heavyweight for v1; no external IdP exists on customer LANs; deferrable without schema cost if keys are designed as a credential _type_.                                                    |
| D. mTLS per client                                           | Strongest transport-level identity; cert distribution/rotation on customer LANs is operationally heavy for v1.                                                                                              |

## Recommended decision

**Option A.** A new `identity`-owned machine-principal concept:

- A **machine principal** is a first-class actor (like a user) that can hold
  roles and therefore permissions (AR-22 codes unchanged).
- An **API key** is a credential bound to exactly one machine principal: opaque
  256-bit token, only the SHA-256 hash stored (same pattern as ADR-0007),
  created/expired/revoked through admin endpoints, all lifecycle audited.
- Requests authenticate via a documented header; every endpoint's permission
  requirement (AR-21) applies unchanged; denials audited with principal id.
- **Licensing gate:** machine access is inert unless the license enables it
  (interacts with ADR-0030; enforcement stays off until OQ-45/ADR-0030
  ratification — the mechanism ships, enforcement does not).
- **Rate limits:** per-key configurable limits, stricter than interactive
  defaults (security.md §5 values are config, not rules).
- **Explicitly deferred:** OAuth2/OIDC, per-endpoint OAuth scopes, public
  self-serve API program (OQ-50/OQ-58), webhooks (OQ-50).

## Consequences

**Security implications.** New credential type enters the threat model:
hash-only storage, constant-time comparison, no secrets in logs (AG-12),
key rotation, per-key audit. Machine principals must not be able to hold
privileged admin roles by default; an explicit policy decision records which
roles are machine-assignable.

**Data implications.** New `identity` tables: machine principals, API keys
(hash, principal, expiry, revoked_at, last_used). Migration required when
implemented — none in this ADR.

**Operational implications.** Admin UI for key lifecycle; per-key usage
visibility; license-gated activation; keys must survive backup/restore
(restore never blocked by license — OQ-53).

**Migration implications.** Additive migration only; no change to existing
session auth; OpenAPI documents the auth header (ADR-0014 contract).

## Rejected alternatives

JWT machine tokens (revocation loss), OAuth2-now (premature), mTLS (operational
weight), unauthenticated LAN trust (violates AR-21).

## Open follow-up items

1. Which roles are machine-assignable (policy — owner, recorded with
   implementation).
2. Exact rate-limit defaults (config, security.md §5 discipline).
3. OQ-50: whether outbound webhooks reuse this principal model (likely yes).
4. Owner ratification of this ADR — **Proposed, not Accepted.**

## Related documents

PB-BASELINE §28; OQ-50, OQ-58; ADR-0006/0007/0014/0016; docs/security.md §5;
docs/integrations.md; roadmap Stage 0 (ratify) / Stage 7 (implement).
