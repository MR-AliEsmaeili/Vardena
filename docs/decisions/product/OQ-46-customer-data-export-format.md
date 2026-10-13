# OQ-46: Customer data export format and completeness

- **Type:** OQ (product/business + operational policy)
- **Status:** **Open — partially resolved.** Owner decision recorded 2026-10-05: **Business Export = Excel; Disaster/Technical Backup = full backup; the two are distinct** (see §Owner decision). Contract-end completeness boundary and who-runs-it policy remain OPEN.
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22 · **Partially decided:** 2026-10-05 (governance re-baseline)
- **Priority:** Medium · Not MVP-blocking (Excel export confirmed)
- **Related docs:** PB-BASELINE §12 (Customer Data Ownership); PD-10; ADR-0009 §6 (Excel export), ADR-0011 (import); OQ-45 (expiry/lockout interplay); roadmap Stage 5/6; **`docs/operations/backup-and-restore.md`** (canonical policy text)

## Owner decision (2026-10-05) — Business Export ≠ Disaster Recovery Backup

```text
Business Export ≠ Disaster Recovery Backup
```

- **Business Export = Excel.** Excel (XLSX) is the channel for
  customer/business data portability.
- **Disaster/Technical Backup = full backup.** The full technical backup is for
  technical restoration/disaster recovery (admin-operated, see
  `docs/operations/backup-and-restore.md`).
- These must **never be conflated** in product, documentation, contracts or
  tests: Excel export is not a recovery mechanism, and the technical backup is
  not the data-portability answer. Future acceptance test: Business Export and
  Technical Backup remain distinct concepts.

**Still OPEN:** whether a database-complete export is contractually promised at
contract end, its exact completeness line (business data? configuration?
audit?), and who runs it. Nothing below is decided by the re-baseline.

## Context

Decided: the customer owns its data; data is never deleted by Vardena at
contract end; export capability must exist; **Excel (XLSX) export is confirmed
for MVP** (reports and lists via the reporting pipeline, ADR-0009 §6).

Unresolved: is Excel *sufficient* as the customer-data-ownership story? Excel
exports are report-shaped (what a report shows), not database-shaped (what the
system stores): they omit ledger structure, document relations, audit trails,
configuration, and immutable history. At contract termination or migration-away,
a customer might legitimately expect a *complete* copy of their data.

## Why this matters

- It defines the honest boundary of the "customer owns its data" promise
  (PD-10) — marketing and contracts must not promise more than the product does.
- It constrains OQ-45: any expiry/termination mode must still allow the decided
  export.
- It affects trust in an on-premise product where the customer could plausibly
  say "it's my server, give me everything."

## Exact decision required

1. Is confirmed Excel export the *complete* data-ownership answer, or is a
   full-fidelity export also required?
2. If full-fidelity: what format (documented SQL dump? structured JSON? CSV
   per entity?), what completeness level (business data only? + configuration?
   + audit?), and who may run it (customer-admin vs Vardena-controlled)?
3. What is the promised boundary in customer contracts?

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Excel only (confirmed export surface)** | Already decided and cheap; matches what accountants ask for | Not database-complete; potential trust gap at contract end |
| **B. Excel + documented logical dump** (pg_dump of customer's own DB + schema/data dictionary) | Trivial on-premise (customer's own server, own DB); complete; strong trust story | Exposes schema; needs documentation effort; "who runs it" policy needed |
| **C. Excel + product-level full export feature** (in-product complete JSON/CSV export) | Product-controlled, works if SaaS ever happens; clean UX | Real build cost; versioning burden; duplicates pg_dump value on-premise |

## Risks

- Over-promising in contracts before the format is decided.
- Option B's "who may run it" must respect the no-customer-source-access and
  controlled-support rules (PB-BASELINE §22) — running pg_dump needs DB
  credentials, which is an operator action, not a customer-admin UI action.

## Dependencies

- OQ-45 (export must remain possible in every post-expiry mode).
- Stage 6 (pilot readiness) should have the answer before first contracts.

## Recommended option

**B for on-premise**: Excel as the user-facing channel (decided) + documented
`pg_dump`-based full export as the contract-end channel (operational runbook,
not a UI feature), with the completeness boundary (business data + configuration;
audit included as files) written into the data-ownership policy. **Recommendation
only — owner decides.**

## Questions requiring product owner confirmation

1. Do you want to promise database-complete export at contract end, or
   Excel-only?
2. If pg_dump-based: acceptable as a Vardena-run operational service in the
   contract-end process?
3. What completeness line do you want in contracts (business data?
   configuration? audit logs?)?

## Decision deadline or dependency

Before Stage 8 (commercial operations) and before pilot contracts are signed
(Stage 6 exit). Not an MVP blocker.

## Related documents

PB-BASELINE §12, §22; ADR-0009 §6; ADR-0011; OQ-45; OQ-53 (restore/DR runbooks
share the same operational shape); roadmap Stage 6/8.
