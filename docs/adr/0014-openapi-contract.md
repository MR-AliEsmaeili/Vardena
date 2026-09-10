# ADR-0014: OpenAPI as the Single API Contract

Status: Accepted
Date: 2026-09-10

## Context

Two teams of agents (backend/frontend) will build against the same API.
Hand-duplicated TypeScript types drift; duplicated Zod schemas on both sides
drift twice. The contract needs one source of truth that is reviewable,
versioned with the code, and machine-usable by both sides.

## Decision

- The **backend DTOs are the source of truth** for the API contract; the
  OpenAPI spec is **generated from them** (NestJS Swagger) and is the published
  contract (`/api/docs`, disabled in production by default).
- **Frontend API types are derived** from the generated OpenAPI spec
  (type generation at build time — the exact generator is an implementation
  detail of the first frontend setup, constrained to the fixed stack's
  tooling ecosystem). No hand-copied duplicate type definitions in `api/`.
- **Frontend runtime validation (Zod)** applies to *user input* (forms) with
  schemas mirroring the request DTOs; API *responses* are treated as typed
  (the backend is trusted within the same product) — documented risk: a
  backend contract change that breaks response shapes is caught by generated
  type mismatch at build time, not runtime.
- **Contract change rules:**
  - additive/compatible changes (new optional fields, new endpoints) → normal
    PR, OpenAPI regenerated;
  - breaking changes (renamed/removed fields, changed semantics) → ADR +
    versioned path (`/api/v2`) or deprecation period — decision at that time;
  - every endpoint declares its permission (AR-21) in the spec's security
    metadata for documentation completeness.
- The spec is the onboarding artifact for any new frontend feature: read the
  operation, use the generated client/type, add the TanStack Query key
  namespace per module (AR-28).

## Consequences

- One definition, two consumers; drift fails at build time (types) rather than
  in production.
- The OpenAPI spec doubles as documentation for QA agents and future
  integrations.
- Frontend build now depends on a generated artifact (committed or built in CI
  — implementation detail; must be deterministic).
- If codegen proves unworkable inside the fixed toolset, fallback is a single
  shared generated TS package built from the spec — still one source of truth
  (an implementation change, not a contract change).
