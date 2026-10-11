# ADR-0046: Signed license documents, retained license versions and deterministic effective-version resolution

- **Status:** Accepted for the first licensing implementation slice (extends ADR-0030 and ADR-0045; does not replace the enforcement chain)
- **Date:** 2026-10-11
- **Product source:** [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) §§3, 5–6, 10–12, 17.2 (guardrails G-3, G-4, G-6, G-9); conflicts resolved or deferred in [PDR-11 §19.4](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) and `docs/tasks/pdr-11-conflict-reconciliation.md`.
- **Design detail:** `docs/licensing/version-model-and-file-exchange.md`
- **Open items preserved:** OQ-45, OQ-53, OQ-74…OQ-85 (`docs/open-questions.md`)

## Context

The implemented foundation (L-01/L-02, ADR-0030, ADR-0045) delivers a license to
an installation as a signed **text code** (`VLIC1.<payload>.<signature>`) and
persists exactly one current license per installation: a new valid code replaces
the old row and marks it `replaced_at`. PDR-11 changes three of those premises —
signed **files** are the primary exchange (§11.3), a future-dated renewal must
coexist with a still-valid version (§3.2), and every operation needs an identity
so a replay cannot change state twice (§10.7, §12.4, G-6). PDR-11 §16 also
requires a design for the version state machine, formats/versioning, replay
protection and migration before any code changes (G-10, AR-29).

## Decision

1. **One signable artifact, two transports, one trust path.** The signed
   artifact is a canonical, versioned document
   `VLIC2.<payload-base64url>.<signature-base64url>` (Ed25519). A **file** is a
   versioned JSON envelope (`format: "vardena-license"`) carrying that artifact;
   pasted text is the same artifact without the envelope. Both decode to the
   exact same signed bytes and pass through one verification pipeline, so the
   text transport is never a weaker trust path (G-8). Legacy `VLIC1` codes keep
   importing through the same pipeline.
2. **License and LicenseVersion are separate, typed facts.** `licensing.licenses`
   becomes the installation-bound commercial license; `licensing.license_versions`
   holds every retained, signed version (dates, limits, status, entitlements,
   signing key id, document hash, source, operation id). Versions are retained,
   never overwritten (PDR-11 §14, CF-17).
3. **A signed document carries its operation.** Each v2 document names a unique
   `operationId`; applying it is a single transaction that inserts the version
   and its audit event. A second application of the same operation is rejected
   with a machine-readable conflict and changes nothing. Legacy `VLIC1` codes
   keep their documented idempotent no-op (`changed: false`) — the asymmetry is
   recorded as OQ-81 (PDR-11 PQ-8, CF-12).
4. **Future-dated documents are importable and take effect by date.** Import
   validates and retains a version whose window starts in the future; the
   currently effective version keeps governing until its own end (PDR-11 §3.2,
   CF-1/CF-2). Evaluation resolves the effective version from retained,
   non-superseded versions at every read: at most one window may cover an
   instant.
5. **Ambiguity is rejected, not resolved.** Windows overlap only through an
   **explicit, signed** supersession (`supersedesOperationId`); otherwise the
   import is rejected and nothing is written (PDR-11 §3.4 leaves overlap
   resolution open — OQ-80). Gaps are allowed: the previous version has expired,
   the next is not yet effective.
6. **Nothing licenses a customer installation into identity.** Import never
   creates, recreates or adopts an installation identity; the document must name
   the identity that already exists (PDR-11 §5.1, §6.5, CF-5).
7. **Rotation is a trust-list operation.** Trusted public keys may carry key
   ids; a document that names an untrusted key is rejected with a distinct
   reason. Already-imported versions stay effective without re-verification, so
   ordinary rotation cannot invalidate a valid perpetual license (PDR-11 §3.1,
   §4.4, CF-8).
8. **Restore and identity loss stay outside licensing enforcement.** Import adds
   no startup gate, no network call and no check on any backup/restore path
   (PDR-11 §6.7, G-9). The dedicated installation **identity key** required by
   §5.1 is specified but **not implemented** here: its storage depends on the
   backup-encryption design (PDR-11 U-2) and its loss path on the replacement
   workflow (PDR-11 U-9, PQ-3) — both still open. Until then the installation id
   remains the binding identifier (ADR-0045 Decision 1).
9. **Owner-side issuance boundary.** Signing stays outside the product: no
   private key is stored, accepted or served by the application; the development
   CLI is the only issuer in the repository and refuses `NODE_ENV=production`
   (PDR-11 §4.4, G-3, CF-19).
10. **Audit is typed.** Import outcomes (applied / rejected / unchanged /
    superseded) are written to a typed `licensing.license_audit_events` table
    inside the same transaction as the state change (PDR-11 §12.7).

## Consequences

- The L-02 tables and their consumer (`LicensingService`,
  `PersistentLicenseProvider`) change shape; a committed migration moves existing
  rows into the version model with no loss of validity, history or idempotency,
  and a rehearsal proves it on a populated database.
- `POST /api/v1/license/activate` keeps working for existing automation; the new
  `POST /api/v1/license/import` is the documented path for signed files and text.
- Evaluation becomes date-driven; expiry, suspension and the
  `ACTIVE|EXPIRED|SUSPENDED` vocabulary are unchanged, and full revocation,
  Grace/Read-Only enforcement, replacement and device licensing remain
  unimplemented and gated by their open items (PDR-11 §15).
- The version table is the future home of revocation/reactivation state; adding
  it now avoids a second lossy migration later.
