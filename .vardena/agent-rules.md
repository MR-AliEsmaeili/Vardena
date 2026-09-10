# Vardena — AI Agent Development Rules

Workflow rules for AI coding agents (and humans) working in this repository.
Complement `.vardena/architecture-rules.md` (what the system must look like) with
*how work gets done here*.

## Onboarding

- **AG-01 — Mandatory reading order** before any change:
  `.vardena/project-context.md` → `docs/architecture.md` →
  `.vardena/architecture-rules.md` → the `docs/*.md` for your area → related ADRs.
  If a doc and the (future) code disagree, the ADR wins; flag the discrepancy.

## Branches & Commits

- **AG-02 — Never commit or push to `main`.** Work on feature branches:
  `feat/<module>-<slug>`, `fix/<module>-<slug>`, `docs/<slug>`, `chore/<slug>`.
  One concern per branch and per PR.
- **AG-03 — Scope discipline.** Touch only files your task requires. No drive-by
  refactors, no unrelated formatting, no "while I was here" changes, no touching
  unrelated modules.
- **AG-04 — Commits.** Small, focused, imperative subject (e.g.
  `inventory: add receipt quantity validation`). Reference ADR/OQ ids when
  relevant. No merge commits for cleanup; no force-push to shared branches.

## Definition of Done

A change is done when **all** hold:

- **AG-05 — Quality gates.** Lint and typecheck pass; tests pass; no new compiler
  or console warnings introduced.
- **AG-06 — Tests for business rules.** Unit tests for domain rules; application
  service tests covering authorization denial paths as well as success paths;
  reporting view regression tests (fixture data → expected rows). No test may call
  a real external system; adapters are tested against mocks/recorded fixtures.
  Tests name the *rule/behavior*, not the implementation.
- **AG-07 — Docs in sync.** If behavior changed, `docs/*.md` (and the module
  section in `docs/modules.md`) updated in the same change. If the *architecture*
  changed, an ADR exists in `docs/adr/` — a PR with an architecture change and no
  ADR must be rejected/reverted.
- **AG-08 — Migrations.** Any DB change ships with its Prisma migration in the same
  change. Never edit an applied migration; add a new one.
- **AG-09 — No invented business rules.** If a rule is unspecified (numbering,
  tax, ledger behavior, approvals, retention, security policy, role sets, currency,
  languages), do NOT guess. Add an entry to `docs/open-questions.md`
  (id `OQ-xx`, area, question, impact, any temporary assumption clearly labeled as
  an assumption) and ask the product owner. Implement against the explicit
  assumption only if the work cannot proceed and the assumption is recorded.
- **AG-10 — API conventions.** New endpoints follow the conventions in
  `docs/architecture.md` §API: kebab-case resource paths under `/api/v1`, standard
  pagination/error shapes, permission declared on every endpoint, OpenAPI updated.
- **AG-11 — Dependency discipline.** Prefer the fixed stack (ADR-0002) and the
  NestJS ecosystem. A new *major* dependency requires an ADR or an OQ with
  justification before it is added.

## Security Defaults (always)

- **AG-12 — No secrets in the repo.** No credentials, tokens, connection strings,
  or certificates in code, tests, fixtures, or config files. Use env vars /
  config. Never disable validation or authorization to make a test pass.
- **AG-13 — Authorization first.** When adding a write endpoint, write the
  permission check and its failing-path test in the same change.

## Frontend Work

- **AG-14 — Feature slices mirror modules.** New UI capability for module X goes
  into `frontend/src/features/x/`. Reuse `ui/` (shadcn) and `lib/` before creating
  new primitives. Grid state (columns, saved filters) persists through the
  customization module, not local storage.

## When to Stop and Ask

- **AG-15 — Pause and ask the human/product owner when:**
  - a business rule is ambiguous (see AG-09),
  - a required cross-module interaction has no existing event or public API,
  - an ADR conflicts with the requested change,
  - a security policy decision is needed (lifetimes, lockout, MFA, tenancy),
  - an external system's real contract is needed (legacy ERP specs — OQ-04).
  Ask concisely: context, options considered, recommendation.

## Self-Review Checklist (before opening a PR)

- [ ] No cross-module table/Prisma access introduced (AR-07)
- [ ] Controllers stayed transport-only (AR-03)
- [ ] Every new endpoint has a permission + denial test (AR-21)
- [ ] External side effects go through the outbox, not direct calls (AR-14)
- [ ] Migrations present and unedited-after-apply (AR-10/08)
- [ ] Tests cover the business rules, including failure paths (AG-06)
- [ ] Docs updated; ADR added if architecture changed (AG-07)
- [ ] No new major dependencies (AG-11)
- [ ] Diff contains nothing unrelated (AG-03)
- [ ] PR description cites the ADR/OQ ids it implements

## AI-Specific Notes

- **AG-16 — Cite the docs.** In PR descriptions and commit messages, reference the
  doc/ADR ids driving the change (e.g. `ADR-0004`, `OQ-04`).
- **AG-17 — Record, don't assume.** When docs seem stale or contradictory, do not
  silently pick a side. Flag it in the PR description and add/update an OQ entry.
- **AG-18 — Prefer the existing pattern.** If a similar feature exists in another
  module, copy its structure (layers, event naming, permission naming) rather than
  inventing a new pattern.
- **AG-19 — Small enough to review.** If a change would exceed ~600 lines of
  meaningful diff, split it into ordered PRs and say so.
