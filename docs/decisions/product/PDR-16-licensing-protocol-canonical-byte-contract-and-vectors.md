# PDR-16 — Licensing protocol canonical byte contract and conformance vectors (D-2)

- **Status:** Decided (2026-10-15) — Product Owner Ali Esmaeili.
- **Type:** Product Decision Record.
- **Authority:** Product Owner Ali Esmaeili (sole authority for product decisions).
- **Scope:** Licensing protocol conformance mechanism and canonical byte contract only.
- **Companion:** [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) · [ADR-0048](../../adr/0048-owner-side-licensing-separation-boundary.md) (Proposed) · [PDR-11](./PDR-11-vardena-licensing-product-requirements.md) · [PDR-15](./PDR-15-client-device-licensing-and-replacement.md) · [owner-side readiness](../../tasks/licensing-owner-side-phase-0-readiness.md) · [protocol vectors](../../licensing/licensing-protocol-vectors.md) · [version model](../../licensing/version-model-and-file-exchange.md).

## Decisions recorded

### D-2(a) — Protocol sharing mechanism: `VECTORS_ONLY` (APPROVED)

The cross-implementation compatibility mechanism for the current scope is a reusable,
deterministic conformance-vector corpus maintained in this repository.

- No shared runtime package is created as part of this task.
- No dependency is introduced from the customer runtime to an Owner-side application.
- Vectors carry expected inputs, canonical bytes, signatures/verification fixtures and
  expected outcomes in a documented, reusable, language-neutral format.
- Vector generation is deterministic; accidental drift is detectable in CI.

### D-2(b) — Canonical byte contract: `APPROVE` (APPROVED, conditional)

The measured existing Node.js canonicalization and escaping behavior is ratified as the
normative contract in `docs/licensing/version-model-and-file-exchange.md` §2.1, **conditional
on executable verification of the actual implementation before ratification** (Phase 0.5B).

Ratified behavior (verified against the implementation before ratification):

- Serialization uses the existing `JSON.stringify` behavior of the canonicalizers in
  `backend/src/modules/licensing/domain/license-code.ts`, `license-document.ts` and
  `client-device.ts`.
- Object keys appear in the exact declared order; arrays that are sorted (`modules`,
  `features`) are sorted before serialization.
- Non-ASCII code points are emitted raw as UTF-8 (not `\uXXXX`).
- `U+0008`, `U+0009`, `U+000A`, `U+000C`, `U+000D` are escaped as `\b`, `\t`,
  `\n`, `\f`, `\r`.
- Every other code point in `U+0000`–`U+001F` is escaped as `\u00xx` with lowercase hex.
- `"`, `\` are escaped as `\"`, `\\`.
- All other code points (including `<`, `>`, `&`, `/`, `U+007F`, `U+2028`, `U+2029`,
  and all non-ASCII) are emitted raw.
- No whitespace between tokens.
- Numbers are integers or `null`; instants are `Date.prototype.toISOString()` form
  (`YYYY-MM-DDTHH:mm:ss.sssZ`, UTC, exactly three fraction digits).
- `VLIC2` conditionally omits `deviceLimit` when `deviceLimitSpecified === false`
  (preserved as UNSPECIFIED); an explicit `null` means unlimited; a finite
  non-negative integer is an explicit quota.

## Compatibility and security constraints (binding)

- No existing signed byte format is changed.
- No new canonicalizer is introduced and no existing signature is routed through a new one.
- No `VLIC3` is introduced.
- No previously issued VLIC1/VLIC2 artifact is invalidated; verification semantics unchanged.
- No signed payload field, default, omission semantics, or key identifier is reinterpreted
  without evidence and explicit authorization.
- This decision does not approve Owner issuer implementation or production key custody.
- OQ-83 and OQ-85 remain OPEN; ADR-0048 remains Proposed.

## Recording date
2026-10-15.

## References
- Canonical byte contract: `docs/licensing/version-model-and-file-exchange.md` §2.1.
- Protocol vector contract: `docs/licensing/licensing-protocol-vectors.md`.
- Vector corpus: `docs/licensing/vectors/` (Phase 1).
- Owner-side readiness: `docs/tasks/licensing-owner-side-phase-0-readiness.md`.
- ADR-0048 (Proposed): `docs/adr/0048-owner-side-licensing-separation-boundary.md`.
