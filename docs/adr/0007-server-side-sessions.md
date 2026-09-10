# ADR-0007: Server-Side Opaque Sessions

Status: Accepted
Date: 2026-09-10

## Context

Vardena needs authentication for an on-premise ERP with strong operational
controls: instant revocation (admin kills a session, user deactivation,
password change), concurrent-session visibility, and no distributed state to
manage on a single site. JWTs offer statelessness (useful for horizontal scale)
but make revocation hard (denylists defeat the purpose) and leak data into
tokens.

## Decision

**Server-side opaque sessions:**

- password + username login; passwords hashed with **argon2id**;
- on login, issue an opaque 256-bit random token; store only its SHA-256 hash
  in `identity.sessions` (token, user, user-agent, IP, created, last-seen,
  absolute expiry, revoked-at);
- deliver via **httpOnly cookie** (`SameSite=Lax`, `Secure` when HTTPS);
- **sliding** idle expiry (default 30 min) with an **absolute** cap (default
  12 h); revocation on logout / admin revoke / deactivation / password change;
- failed-login lockout (default 5 failures → 15 min, config) + `Login.Failed`
  audit events;
- MFA deferred (hooks reserved), self-service reset deferred (admin-initiated
  only) — policy details are OQ-06.

## Consequences

- Full revocation and session management (admin UI: list/revoke), centralized in
  one table — operations-friendly on-premise.
- One extra DB read per request (session lookup) — negligible at ERP scale;
  cached per request middleware, not per hop.
- Stateless API nodes for the cloud path: sessions already live in Postgres, so
  horizontal scaling is a deployment change, not an architecture change.
- A future machine-to-machine API (e.g. integration-to-integration) would use a
  separate credential mechanism (client credentials) — ADR at that time; user
  sessions stay for humans.
