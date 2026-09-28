# OQ-50: Webhooks and API surface beyond ADR-0029

- **Type:** OQ (product/architecture boundary)
- **Status:** Open
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** Low-Medium · Not MVP-blocking
- **Related docs:** PB-BASELINE §28, PD-35/PD-36; ADR-0029 (proposed machine/API access model); OQ-53, OQ-58; integrations.md (outbox); roadmap Stage 7

## Context

ADR-0029 (proposed) resolves the _machine access foundation_: licensed API
access via API keys bound to a machine principal, permissions = the existing
granular RBAC codes, rate limits configurable, OAuth2 and public API program
explicitly deferred. That leaves a bounded set of API-surface questions
deliberately not decided:

1. **Webhooks (outbound)**: should Vardena push event notifications (e.g.
   "Invoice.Issued") to customer-configured HTTP endpoints? The outbox already
   gives durable, retried, per-destination delivery — a webhook adapter is
   architecturally natural.
2. **Webhooks (inbound)**: callbacks from external systems (payment gateways,
   Taxpayer status callbacks) — currently handled by adapter inbound handlers
   (integrations.md §3); do product-level webhook subscriptions ever exist?
3. **API deprecation policy**: how long is a version supported after a new one
   appears (contract-continuity question for integrators)?
4. **Public availability**: is there ever a _public_ API program (self-serve
   keys, docs portal), or does API access stay deal-driven per customer?

## Why this matters

- Webhooks are the highest-value near-term extension (they reuse the outbox);
  deciding them early prevents ad-hoc push mechanisms later.
- Deprecation policy matters the moment a first external integration ships —
  a broken integration is a broken customer commitment.
- "Public vs deal-driven" is a commercial posture, not a technical one.

## Exact decision required

1. Are outbound webhooks in the product plan, and in which stage?
2. Is inbound product-level webhook subscription ever needed (vs adapter
   inbound handlers)?
3. Deprecation window policy (e.g. N-1 version supported for 12 months)?
4. Public API program: yes/no/later, and under what commercial shape?

## Options

| Option                                                                                                                            | Advantages                                                | Disadvantages                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| **A. No webhooks; adapters only**                                                                                                 | Zero new surface; inbound stays adapter-managed           | Customers with bespoke integrations must poll              |
| **B. Outbound webhooks as an integration destination** (customer-configured endpoint + secret + event selection; outbox delivery) | Reuses ADR-0004 wholesale; high integrator value; bounded | Endpoint security guidance + delivery monitoring UI needed |
| **C. Full webhook platform (in+out, subscriptions UI, retry dashboards)**                                                         | Platform story                                            | Large; premature without integrator demand                 |

## Risks

- Outbound webhooks leak data to customer-configured endpoints → payload
  allowlist per event + secrets management + audit are mandatory (security.md
  §7 posture).
- Deprecation promises made casually become support burden.

## Dependencies

- ADR-0029 (machine access) — webhooks authenticate via the same machine
  identity model or not at all.
- OQ-58 (public release posture) — a public API program changes this answer.
- Demand evidence from first integrations (Stage 7+).

## Recommended option

**B later, A now**: no webhooks in MVP/post-MVP stages until a concrete
integration requires them; when needed, outbound webhooks join the adapter
registry as `destination = webhook:<customer-endpoint>` under ADR-0029's
machine-access model. **Recommendation only.**

## Questions requiring product owner confirmation

1. Do any known customer/deal requirements include event push to external
   systems?
2. Is a public (self-serve) API program ever intended, or is API access always
   per-customer licensed?
3. What minimum deprecation window would you want integrators to expect?

## Decision deadline or dependency

Stage 7 planning at the earliest; no MVP impact.

## Related documents

PB-BASELINE §28; ADR-0029; OQ-58; integrations.md §2/§4; roadmap Stage 7.
