# Licensing protocol conformance vectors — contract and gap analysis

**Status:** Phase 1 implemented (2026-10-15). D-2(a)=VECTORS_ONLY and D-2(b)=APPROVE
recorded in [PDR-16](../decisions/product/PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md).
Vector corpus published under `docs/licensing/vectors/`. Canonical byte contract ratified in
`version-model-and-file-exchange.md` §2.1.
**Baseline:** `main` @ `961a696fbff16893dc69f93d6409af5430790a6c`.
**Companion:** [Owner-side architecture](./owner-side-system-architecture.md) ·
[Phase 0 readiness report](../tasks/licensing-owner-side-phase-0-readiness.md).

## 1. Why this document exists

The Owner system and the customer server must agree **byte for byte** on what is
signed. Today that agreement is guaranteed only because both sides are the same
TypeScript code: the test suite generates an artifact with
`canonicalizeDeviceReplacementResponse` and verifies it with
`verifyDeviceReplacementResponse` in the same module. That is self-consistency,
not a contract. A second implementation — a different language, a different JSON
encoder, or the same language with different encoder options — has nothing to
conform to except the source code of the first.

The [OQ-83 operational plan §5](../tasks/licensing-oq-83-operational-plan.md)
already names this as a required evidence item ("shared protocol vectors for
UTF-8 bytes, SPKI, Base64URL, request hash, VDRQ1, and VDRP1 across
server/client/issuer") and Phase 0 of its §7 plan requires publishing them. This
document specifies what that vector set must contain and records precisely where
the current contract is **insufficient** to build it.

## 2. GAP-3 — the canonical byte contract is not language-neutral

### 2.1 What is specified today

[`version-model-and-file-exchange.md`](./version-model-and-file-exchange.md) §2.1
says: *"Canonical payload (fixed key order, sorted arrays, ISO-8601 UTC
instants)"* and *"the payload must round-trip to exactly the signed bytes"*.
The code implements this as `JSON.stringify` over an object literal whose
properties are written in the intended order
(`canonicalizeLicenseVersion`, `canonicalizeEnrollmentChallenge`,
`canonicalizeDeviceReplacementChallenge`,
`canonicalizeDeviceReplacementResponse`).

That specifies **key order** and **value normalization**. It does not specify
**string escaping**, and JSON escaping is exactly where encoders diverge.

### 2.2 Measured behaviour of the current implementation

Verified on Node 22 by replicating the exact wire shape:

| Input character in a signed string field | `JSON.stringify` output | RFC 8259 requires? |
| --- | --- | --- |
| Persian / any non-ASCII (e.g. `U+0634`) | emitted **raw** as UTF-8 | permitted either way |
| `<` `>` `&` | emitted **raw** | permitted either way |
| `/` | emitted **raw** (not `\/`) | permitted either way |
| `U+007F` (DEL) | emitted **raw** | permitted either way |
| `U+2028` / `U+2029` | emitted **raw** | permitted either way |
| `U+0008` `U+0009` `U+000A` `U+000C` `U+000D` | `\b` `\t` `\n` `\f` `\r` | **required** |
| other `U+0000`–`U+001F` | `\u00xx` — **lowercase** hex | required, case unspecified |
| `"` and `\` | `\"` `\\` | **required** |

Every "permitted either way" row is a **divergence risk**. Concretely:

- **Python** `json.dumps(..., ensure_ascii=True)` — the default — escapes *all*
  non-ASCII as `\uXXXX`. A Persian `customerName` produces different bytes and
  the signature fails.
- **Go** `encoding/json.Marshal` escapes `<`, `>`, `&` as `\u003c`, `\u003e`,
  `\u0026` and also escapes `U+2028`/`U+2029`. Different bytes for any name
  containing those.
- **Rust** `serde_json` emits non-ASCII raw and escapes only what is required —
  closest match, but `/` and number formatting are still unstated.
- **Lowercase vs uppercase** `\u00xx` hex is not fixed by RFC 8259, so two
  conforming encoders can disagree.

### 2.3 Where the exposure actually is

Not every field can carry the divergence. The identifier patterns restrict most
of the payload to ASCII:

```text
ID_PATTERN           /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/    → 2..64 chars, ASCII only
CUSTOMER_ID_PATTERN  same
CUSTOMER_CODE_PATTERN same
CODE_PATTERN         /^[a-z][a-z0-9-]{1,39}$/                → module/feature codes, ASCII
FINGERPRINT_PATTERN  /^[a-f0-9]{64}$/                        → lowercase hex, ASCII
BASE64URL_PATTERN    /^[A-Za-z0-9_-]+$/                      → ASCII, no padding
```

The **one** unrestricted-text field in the signed payloads is `customerName`
(`VLIC2` and `VLIC1` only): `assertValidCustomerName` trims and length-checks
(1..200) and imposes **no charset restriction**. It is a Persian-first product,
so this field will routinely contain non-ASCII in production.

`VDEA1`, `VDRQ1` and `VDRP1` contain **no** free-text field — every member is an
ASCII-constrained identifier, an ISO instant, a base64url string or a hex hash.
Their canonical bytes are therefore ASCII-only, and for ASCII the divergence
table above collapses to nothing.

**Conclusion:** the exposure is real but narrow — it is `customerName` inside
`VLIC2`/`VLIC1`, and it is exactly the field an Owner system will populate with
Persian text. This is the highest-value gap to close, and closing it does **not**
require changing any signed format.

### 2.4 Proposed resolution — PENDING D-2, NOT ratified by this document

The signed format must not be changed for implementation convenience (task red
line; PDR-11 §15 U-8). The compatible resolution would be to **write down** the
existing behaviour as a normative rule rather than to alter it. The text below is
a **proposal for Product Owner ratification under decision D-2(b)** (see the
[decision table](../tasks/licensing-owner-side-phase-0-readiness.md)). It is
**not** a contract, it is not in force, and nothing in this repository may treat
it as the specification until the Product Owner explicitly approves it and it is
committed into
[`version-model-and-file-exchange.md`](./version-model-and-file-exchange.md) §2.1
as **Phase 0.5B**:

> **Canonical JSON string escaping (PROPOSED normative text — awaiting D-2(b)).**
> A signed canonical payload is the UTF-8 encoding of a JSON text in which:
> object keys appear in the exact declared order; `"` and `\` are escaped as
> `\"` and `\\`; `U+0008`, `U+0009`, `U+000A`, `U+000C`, `U+000D` are escaped as
> `\b`, `\t`, `\n`, `\f`, `\r`; every other code point in `U+0000`–`U+001F` is
> escaped as `\u00xx` with **lowercase** hex; and **every other code point is
> emitted raw as UTF-8**, including all non-ASCII, `U+007F`, `U+2028`, `U+2029`,
> `<`, `>`, `&` and `/`. No whitespace is inserted between tokens. Numbers are
> integers or `null`. Instants are `Date.prototype.toISOString()` form,
> `YYYY-MM-DDTHH:mm:ss.sssZ`, always UTC with exactly three fraction digits.

**Current status of the escaping behaviour:** it is an *undocumented
implementation artefact of Node's `JSON.stringify`*. It is measured and
reproducible (§2.2), and the code depends on it, but it is **not** a ratified
contract and this document does **not** ratify it. Recording it here prevents a
second implementation from guessing; it does not make it normative.

If ratified as written, the change is documentation-only: it would describe what
the code already does, so every already-issued artifact would still verify and no
customer behaviour would change. It is the precondition for any second
implementation. If the Product Owner instead prefers a *different* escaping rule
(for example RFC 8785 JCS with `\uXXXX` for non-ASCII), that is a **format
change** requiring a versioned `VLIC3` and a U-8 backward-compatibility decision
— it must not be made silently inside vector work, and it must not be inferred
from this proposal.

Note also that this proposal is **separate from Phase 0.5A** (the customer-package
remediation of GAP-1/GAP-2). Phase 0.5A needs no part of D-2 and touches no
contract text; the two must not be bundled into one change.

## 3. The rest of the byte contract (already exact, needs publishing)

These are fully determined by the code and unambiguous; they only need to be
stated outside TypeScript.

### 3.1 Armor

```text
VLIC2.<base64url(canonical payload UTF-8)>.<base64url(Ed25519 signature)>
VDRQ1.<base64url(canonical payload UTF-8)>.<base64url(Ed25519 signature)>
VDRP1.<base64url(canonical payload UTF-8)>.<base64url(Ed25519 signature)>
VLIC1.<base64url(canonical payload UTF-8)>.<base64url(Ed25519 signature)>
```

- Base64URL alphabet `[A-Za-z0-9_-]`, **unpadded** — enforced both by
  `BASE64URL_PATTERN` and by a strict round-trip re-encode check
  (`decoded.toString('base64url') !== value` ⇒ reject). Padded or standard-alphabet
  input is refused, not repaired.
- Ed25519 signature is exactly **64 bytes**; SPKI public key DER is exactly
  **44 bytes**.
- Separator is `.`, exactly three segments.

### 3.2 Public key and fingerprint

- Encoding: canonical DER SubjectPublicKeyInfo, base64url, no PEM.
- **Canonicality is enforced**: the parsed key is re-exported and compared
  byte-for-byte with the input; a non-canonical encoding is rejected
  (`noncanonical-key`). Key type must be `ed25519`.
- `publicKeyFingerprint` = **full** SHA-256 of the 44-byte DER, lowercase hex,
  64 characters.

> **Do not conflate two fingerprint conventions.** `hashKeyMaterial` in
> `license-document.ts` produces a *key id* of the form
> `sha256-<first 16 hex of SPKI DER>` and is used for trusted-key list entries
> that omit an explicit id. The device `publicKeyFingerprint` is the *full*
> 64-hex digest with no prefix. They are different values derived from the same
> bytes. A vector set must carry both, labelled distinctly, or an implementer
> will use one where the other is required.

### 3.3 Request hash

`requestHash` in `VDRP1` is the SHA-256 hex digest of the **armored `VDRQ1`
artifact string as UTF-8** — not of the canonical payload, and not of the file
envelope. Confirmed at `client-devices.repository.ts` (`sha256(artifact)` on
both write and re-verify). Likewise `artifactHash` for a response is SHA-256 of
the decoded `VDRP1` artifact string.

This is the single most likely interop mistake: hashing the decoded payload
instead of the armored artifact yields a plausible-looking 64-hex value that the
customer server rejects. It must be an explicit vector.

**Committed evidence.** The rule is pinned by an independent oracle in
`licensing-protocol-vectors.spec.ts`: the expected digest is a literal in the
test, the actual digest is computed from the committed `OK-03` armored bytes
with `node:crypto` alone, and three negative controls pin the digests that must
*not* be the `requestHash` — the decoded canonical payload, the JSON file
envelope, and the same payload with its field order reversed. `OK-03` and
`OK-04` also record `requestHash` and `approvesRequestHash`, so the pair can be
correlated from the committed files without regenerating anything. See §5.1 for
why a generated vector cannot carry this assertion on its own.

### 3.4 File envelopes

| Artifact | `format` | `fileVersion` | Payload key | Extra keys |
| --- | --- | --- | --- | --- |
| License | `vardena-license` | `1` | `document` | optional `keyId` (hint only) |
| Replacement request | `vardena-device-replacement-request` | `1` | `request` | none |
| Replacement response | `vardena-device-replacement-response` | `1` | `response` | none |

- Envelopes are serialized with `JSON.stringify(obj, null, 2)`; the license
  envelope adds a trailing newline. **Serialization indentation is not part of
  the contract** — envelopes are parsed with `JSON.parse` and are explicitly
  *untrusted*, contributing no licensing fact (ADR-0046 Decision 1, G-8). An
  Owner implementation may write them compactly.
- The key set is checked **exactly** (`assertExactKeys`): an unknown top-level
  key is rejected. `fileVersion` must equal `1`.
- The license envelope's `keyId` is a *hint* checked against the trust list; it
  is never taken on faith, and its absence must not weaken verification.
- Size bound on inbound device files: `DEVICE_REPLACEMENT_MAX_FILE_BYTES` =
  **65 536**, applied before parsing.
- TTLs: enrollment challenge **15 minutes**; replacement request **30 days**.

### 3.5 Canonical field orders

The exact ordered key list per format is in the source
(`canonicalizeLicenseVersion`, `canonicalizeEnrollmentChallenge`,
`canonicalizeDeviceReplacementChallenge`,
`canonicalizeDeviceReplacementResponse`) and is reproduced in
[`version-model-and-file-exchange.md`](./version-model-and-file-exchange.md) §2.1
for `VLIC2` and in [`client-device-lifecycle.md`](./client-device-lifecycle.md)
§4 for `VDRQ1`/`VDRP1`. Two corrections a vector set must carry:

- The §2.1 `VLIC2` example predates OQ-83 and **omits `deviceLimit`**. The field
  is conditionally present: emitted only when `deviceLimitSpecified` is true,
  positioned after `userLimit` and before `modules`. Its absence means
  **UNSPECIFIED** — neither zero nor unlimited — and blocks device registration.
  Both shapes need vectors, because both are in the field.
- `modules` and `features` are **sorted** (byte order) before serialization; a
  vector must include an unsorted input mapping to sorted output.

## 4. Required vector set

A vector is one JSON object: a name, a category, the inputs, and the exact
expected bytes or the exact expected refusal reason. Refusal reasons must be the
**stable** strings the customer already returns, so a vector failure names a
real behaviour rather than a test-local label.

### 4.1 Encoding primitives

| ID | Vector | Asserts |
| --- | --- | --- |
| ENC-01 | base64url of fixed byte strings, lengths 1/2/3 mod 3 | unpadded output |
| ENC-02 | padded and standard-alphabet base64 input | rejected, not repaired |
| ENC-03 | round-trip re-encode of each accepted value | strict canonicality |
| ENC-04 | Ed25519 SPKI DER, 44 bytes, base64url | accepted |
| ENC-05 | SPKI DER of 43 and 45 bytes | rejected (`invalid-public-key`) |
| ENC-06 | valid key with a non-canonical DER encoding | rejected (`noncanonical-key`) |
| ENC-07 | RSA/ECDSA SPKI of correct length | rejected (not `ed25519`) |
| ENC-08 | fingerprint of a known DER | full 64-char lowercase hex |
| ENC-09 | trusted-key id of the same DER | `sha256-<16 hex>` — **distinct from ENC-08** |
| ENC-10 | SHA-256 of an armored artifact vs of its decoded payload | different digests; `requestHash` is the **artifact** digest |

### 4.2 Canonicalization

| ID | Vector | Asserts |
| --- | --- | --- |
| CAN-01 | `VLIC2` payload, all fields ASCII | exact expected UTF-8 bytes |
| CAN-02 | `VLIC2` with a Persian `customerName` | non-ASCII emitted **raw**, not `\uXXXX` |
| CAN-03 | `customerName` containing `<`, `>`, `&`, `/` | all emitted raw |
| CAN-04 | `customerName` containing `U+007F`, `U+2028`, `U+2029` | all emitted raw |
| CAN-05 | `customerName` containing `"` and `\` | escaped as `\"` and `\\` |
| CAN-06 | `customerName` containing `U+0000`, `U+0008`, `U+0009`, `U+000A`, `U+000C`, `U+000D`, `U+001F` | `\u0000`, `\b`, `\t`, `\n`, `\f`, `\r`, `\u001f` — lowercase hex |
| CAN-07 | unsorted `modules`/`features` | sorted in output bytes |
| CAN-08 | `deviceLimitSpecified: false` | `deviceLimit` key **absent** from bytes |
| CAN-09 | `deviceLimitSpecified: true`, `deviceLimit: null` | key present with `null` (unlimited) |
| CAN-10 | `deviceLimitSpecified: true`, `deviceLimit: 0` | key present with `0` (finite zero, grants nothing) |
| CAN-11 | instants | exactly three fraction digits, `Z`, UTC |
| CAN-12 | `VDEA1`, `VDRQ1`, `VDRP1` canonical bytes | exact expected UTF-8, ASCII-only |
| CAN-13 | re-serialization of a parsed payload | byte-identical to the signed body (round-trip rule) |

### 4.3 Valid artifacts

Each with a **published, non-secret, test-only** Ed25519 key pair whose private
half is a documented fixture and never a production key:

| ID | Vector |
| --- | --- |
| OK-01 | `VLIC2` finite term, finite limits, specified device limit — file envelope |
| OK-02 | same artifact, text transport — identical bytes, identical result |
| OK-03 | `VLIC2` perpetual (`validUntil: null`), unlimited limits (`null`) |
| OK-04 | `VLIC2` pre-OQ-83 shape, no `deviceLimit` — verifies, UNSPECIFIED |
| OK-05 | `VLIC1` legacy code without `customerCode` — verifies via the legacy path |
| OK-06 | `VLIC2` with an explicit `keyId` envelope hint matching the trust list |
| OK-07 | `VLIC2` with an explicit supersession (`supersedesOperationId`) |
| OK-08 | `VDEA1` enrollment challenge, signed by a valid device key |
| OK-09 | `VDRQ1` request, device signature over exact canonical bytes |
| OK-10 | `VDRP1` response, authority signature, correct `requestHash` |

### 4.4 Invalid artifacts — signature and key

| ID | Vector | Expected refusal |
| --- | --- | --- |
| BAD-SIG-01 | one bit flipped in the payload segment | `signature` |
| BAD-SIG-02 | one bit flipped in the signature segment | `signature` / `response-signature` |
| BAD-SIG-03 | valid signature by an **unknown** authority key | `unknown-key` (distinct from `signature`) |
| BAD-SIG-04 | signature by a key removed from the trust list | `unknown-key` |
| BAD-SIG-05 | signature by the device key over a `VDRP1` | rejected — wrong key class |
| BAD-SIG-06 | 63- and 65-byte signature | `invalid-signature` |
| BAD-SIG-07 | envelope `keyId` naming a trusted key that did **not** sign | rejected — hint never overrides verification |
| BAD-SIG-08 | unsigned artifact / missing third segment | `malformed` |

### 4.5 Invalid artifacts — structure and validity

| ID | Vector | Expected refusal |
| --- | --- | --- |
| BAD-STR-01 | unknown top-level envelope key | rejected (`assertExactKeys`) |
| BAD-STR-02 | `fileVersion: 2` | `unsupported-version` / `unsupported-response-version` |
| BAD-STR-03 | unknown payload key | `payload` |
| BAD-STR-04 | missing required payload key | `payload` |
| BAD-STR-05 | wrong key order, same content | round-trip mismatch ⇒ `payload` |
| BAD-STR-06 | `v: 3` | `unsupported-version` |
| BAD-STR-07 | non-ISO or offset-bearing instant | `validity` / `malformed-response` |
| BAD-STR-08 | negative limit | `limits` |
| BAD-STR-09 | unknown module code | `entitlements` |
| BAD-STR-10 | `customerCode === customerId` | customer-code refusal |
| BAD-STR-11 | `deviceLimit` present while `deviceLimitSpecified` is false | inconsistent — rejected |
| BAD-STR-12 | file over 65 536 bytes | rejected before parsing |
| BAD-STR-13 | `decision` other than `APPROVE` | `malformed-response` |

### 4.6 Validity, replay and binding

These vectors cover cases where a correctly signed artifact still needs the
appropriate validity, replay, or binding behavior; some are successful replay
outcomes rather than refusals:

| ID | Vector | Expected behavior / refusal |
| --- | --- | --- |
| TIME-01 | response `expiresAt` in the past | expired |
| TIME-02 | response window outside the retained request window | `malformed-response` (outside request/license window) |
| TIME-03 | response window beyond the governing license `validUntil` | same |
| TIME-04 | enrollment challenge older than 15 minutes | expired |
| TIME-05 | replacement request older than 30 days | expired |
| REPLAY-01 | VLIC2 operation already committed; retry has the same installation-scoped `operationId` and matching versioned semantic fingerprint | After current authorization/validity checks, return that operation's persisted receipt; no state change or repeated effects/audit. Same ID with a mismatching fingerprint is a machine-readable conflict. Current implementation still rejects duplicates; receipt replay is the OQ-81 implementation target. |
| REPLAY-02 | identical `responseOperationId` presented twice | replay refusal |
| REPLAY-03 | response presented after successful completion | replay refusal |
| REPLAY-04 | response presented for a **cancelled** request | refused, old device stays `ACTIVE` |
| REPLAY-05 | response presented for an **expired** request | refused |
| BIND-01 | `customerId` differs from the persisted customer | `customer-code-mismatch` / correlation refusal |
| BIND-02 | `customerCode` differs, `customerId` matches | `customer-code-mismatch` (409, nothing written) |
| BIND-03 | `installationId` differs from this installation | correlation refusal |
| BIND-04 | `licenseId` retained under another customer | `license-binding-conflict` |
| BIND-05 | `licenseId` owned by another installation | `license-binding-conflict` |
| BIND-06 | `licenseVersionId` no longer governs | refused; pending operation marked `EXPIRED` |
| BIND-07 | `oldDeviceId` not an `ACTIVE` device of this installation | correlation refusal |
| BIND-08 | `newDeviceId` differs from the request's | correlation refusal |
| BIND-09 | `publicKeyFingerprint` differs from the request's | correlation refusal |
| BIND-10 | `requestHash` does not match the retained request | hash-mismatch refusal |
| BIND-11 | `challengeId` / `requestOperationId` mismatch | correlation refusal |
| BIND-12 | overlapping retained windows without a named supersession | `overlapping-range` (409, nothing written) |
| BIND-13 | supersession naming one version while overlapping a second | `overlapping-range` (409, nothing written) |
| BIND-14 | reduction below current usage without resolution | `reduction-requires-resolution` |
| BIND-15 | supersession rewriting governance already exercised | `backdated-supersession` (422, nothing written) |
| BIND-16 | renewal starting after a coverage gap | `renewal-gap` / `post-gap-recovery-requires-dedicated-operation` |

### 4.7 Key rotation

| ID | Vector | Asserts |
| --- | --- | --- |
| ROT-01 | artifact signed by key A while A and B are both trusted | accepted, `keyId` = A |
| ROT-02 | artifact signed by B after A is retired from the list | accepted |
| ROT-03 | artifact signed by A after A is retired | `unknown-key` |
| ROT-04 | a version imported under A, then A retired | already-imported version stays effective without re-verification (ADR-0046 Decision 7) |
| ROT-05 | duplicate key id in the trust list | configuration load fails |
| ROT-06 | bare trust-list entry (no `keyId:` prefix) | derived id `sha256-<16 hex>` |

## 5. Vector format and generation

```text
docs/licensing/vectors/
  README.md                     — how to consume, licence of the fixtures
  keys/
    authority-a.json            — TEST-ONLY key pair, private half published
    authority-b.json            — second key, for rotation vectors
    device-01.json              — TEST-ONLY device key pair
  canonical/
    CAN-01.json … CAN-13.json   — { name, payload, expectedBytesUtf8 }
  valid/
    OK-01.json … OK-10.json     — { name, artifact, envelope, keyId, expected payload }
  invalid/
    BAD-SIG-01.json …           — { name, artifact, expectedReason }
    BAD-STR-*.json
    TIME-*.json
    REPLAY-*.json
    BIND-*.json
  rotation/
    ROT-*.json                  — { name, trustList, artifact, expectedResult }
```

Generation rule — this is what makes the vectors trustworthy:

1. Vectors are **generated from the current canonical customer implementation**,
   not hand-written, so they cannot encode a misunderstanding of it
   ([OQ-83 plan §7 Phase 0](../tasks/licensing-oq-83-operational-plan.md):
   "published … from the current canonical server implementation").
2. The generator is deterministic: fixed keys, fixed instants, no
   `Date.now()`, no random ids. Re-running it must produce byte-identical files,
   so a diff in CI means the contract moved.
3. A CI step regenerates the vectors and fails if the committed files differ.
   That converts "the vectors are stale" from a hope into a gate.
4. Every refusal vector carries the **stable reason string** the implementation
   actually produces, asserted against the real code path — not a paraphrase.
5. The customer test suite gains a conformance test that loads the vector
   directory and asserts each one. The Owner implementation later loads the same
   directory. Same files, both sides, one contract.

### 5.1 Generated vectors vs independent golden fixtures

Rule 1 above — "generated from the current canonical customer implementation" —
is what makes the corpus *faithful*, and it is also why the corpus alone cannot
be *authoritative*. A file the implementation generated cannot refute that
implementation: if the canonicalizer and the generator both move, regeneration
stays byte-identical, CI stays green, and the contract has silently changed. The
corpus therefore has two distinct roles, and a consumer must know which one it
is reading.

| | **Generated vector** | **Independent golden fixture** |
| --- | --- | --- |
| Purpose | drift detection — did the implementation move? | contract proof — does it match the *documented* rule? |
| Produced by | `npm run license:vectors` from production canonicalizers | pinned by hand in the test tree as a literal |
| Committed under | `docs/licensing/vectors/**` | `backend/src/modules/licensing/domain/*.spec.ts` |
| Verified in CI by | regenerate + `git diff --exit-code` | a literal that no production code path computes |
| Fails when | the implementation changes output | the implementation *or the generator* changes output |
| Cannot catch | implementation and generator moving together | nothing on its own — it needs the corpus as input |

Both are required and they are not interchangeable:

- `docs/licensing/vectors/**` — the **generated corpus**. Regenerated in CI; a
  diff means the contract moved and the change must be explained.
- `canonical-byte-independent.spec.ts` — **pinned canonical byte literals** for
  `VLIC2`/`VLIC1`/`VDEA1`/`VDRQ1`/`VDRP1`. These strings are typed into the
  test, are not derived from a canonicalizer at test time, and are the D-2(b)
  executable evidence for the ratified byte contract.
- `licensing-protocol-vectors.spec.ts` — the **corpus conformance test**. Where
  it asserts a digest it must pin the expected value as a literal and compute
  the actual value from the committed fixture bytes with `node:crypto` alone.
  Reconstructing an artifact inside the test from generator-supplied bytes and
  then hashing it with the same primitive the generator used is a tautology: it
  asserts only that SHA-256 is deterministic, and it passes even when the
  committed fixture is wrong.

**Who signed a fixture is part of the fixture.** Every `valid/OK-*.json` carries
an explicit `signer`, because an artifact whose signer is ambiguous cannot be
verified by a second implementation:

| Fixture | `signer` | Signer identity field | Verifying key |
| --- | --- | --- | --- |
| `OK-01` (`VLIC2`) | `authority-a` | `keyId` — `sha256-<first 16 hex of SPKI DER>` | issuing authority |
| `OK-02` (`VLIC1`) | `authority-a` | `keyId` — same convention | issuing authority |
| `OK-03` (`VDRQ1`) | `device-01` | `devicePublicKeyFingerprint` — **full 64-hex** SHA-256 of SPKI DER, no prefix | the **new device** |
| `OK-04` (`VDRP1`) | `authority-a` | `keyId` + in-payload `keyId` | issuing authority |

A `VDRQ1` is the **new device's** detached Ed25519 proof of possession over the
exact canonical request bytes (§4.3; the customer API contract says "sign with
the new device private key"). It is never an authority signature, and it carries
no authority `keyId` — the payload advertises the device's own SPKI public key
and its full 64-hex fingerprint, so an authority-signed `VDRQ1` fixture is one
that no conforming verifier can accept. `OK-03` additionally records the
`requestHash` it must produce, and `OK-04` records `approvesRequestHash`, so the
request/response pair can be correlated from the committed files alone. The two
fingerprint conventions are different values over the same bytes; §3.2 is the
authority on which one a given field uses.

### 5.2 Committed corpus vs required set

§4 is the **required set** — the normative target, using `ENC-*`, `CAN-*`,
`OK-*`, `BAD-SIG-*`, `BAD-STR-*`, `TIME-*`, `REPLAY-*`, `BIND-*` and `ROT-*`
identifiers. `docs/licensing/vectors/` is the **committed corpus** — a partial
implementation of that set with its own shorter identifiers. **The identifier
spaces are independent and must not be read as the same vector**: required
`OK-03` is a `VLIC2` perpetual artifact, while committed `OK-03.json` is the
`VDRQ1` request. Read a committed file's `protocolVersion` and `name`, never its
number.

Committed coverage as of Phase 1 (what exists, not what is still owed). The
mapping was read off the committed files, not off this document's intent:

| Committed | Asserts | Covers required |
| --- | --- | --- |
| `CAN-01` | `VLIC2`, Persian `customerName` raw UTF-8; `modules` input `["inventory","accounting"]` → output `["accounting","inventory"]`; `deviceLimit: 12` | CAN-02, CAN-07, CAN-11 |
| `CAN-02` | `customerName` `a\u0001b\u001f\u007f<>&/\u2028\u2029` — `<>&/`, `U+007F`, `U+2028`, `U+2029` raw; `U+0001`/`U+001F` as lowercase `\u00xx` | CAN-03, CAN-04, CAN-06 (partly) |
| `CAN-03` | `deviceLimitSpecified: false` → `deviceLimit` key absent | CAN-08 |
| `CAN-04` | `deviceLimitSpecified: true`, `deviceLimit: null` → key present, `null` | CAN-09 |
| `CAN-05` | `VLIC1` legacy payload bytes | no §4.2 row — extra legacy coverage |
| `CAN-06` | `VDEA1` canonical bytes | CAN-12 |
| `CAN-07` | `VDRQ1` canonical bytes | CAN-12 |
| `CAN-08` | `VDRP1` canonical bytes, incl. `requestHash` over the armored artifact | CAN-12, ENC-10 |
| `OK-01`, `OK-02` | `VLIC2` and `VLIC1` verify under authority A | OK-01, OK-02, OK-05 |
| `OK-03` | `VDRQ1` with a **device** detached signature; records its `requestHash` | OK-09 |
| `OK-04` | `VDRP1` authority signature; records `approvesRequestHash` | OK-10 |
| `BAD-01…BAD-04` | tampered payload, untrusted authority B, missing segment, `VLIC9` prefix | BAD-SIG-01/02, BAD-STR-* (partly) |
| `BAD-05` | tampered `requestHash` → `response-signature` | §4.4 tamper case |
| `ROT-01`, `ROT-02` | accepted while A+B trusted; rejected once A retired | §4.7 |

**Not committed — outstanding Phase 1 scope**, recorded so that "the corpus
passes" is never mistaken for "the required set is complete":

| Required | Gap |
| --- | --- |
| CAN-01 | an all-ASCII `VLIC2` baseline — every committed `VLIC2` vector carries a Persian or control-character name |
| CAN-05 | `"` and `\` inside a string value → `\"` and `\\`; no committed vector contains either |
| CAN-06 | the short escapes `\b`, `\t`, `\n`, `\f`, `\r` and `\u0000`; committed `CAN-02` exercises only the `\u00xx` form |
| CAN-10 | `deviceLimitSpecified: true`, `deviceLimit: 0` — finite zero grants nothing |
| CAN-13 | round-trip re-serialization as a corpus vector (the `VDRQ1` round-trip is asserted in the test tree by the reordered-fields control) |
| ENC-01…ENC-09 | encoding primitives — asserted by the domain unit tests, not published as vectors |
| OK-03, OK-04, OK-06, OK-07, OK-08 | `VLIC2` perpetual, pre-OQ-83 shape, explicit `keyId` hint, explicit supersession, `VDEA1` artifact |
| BAD-SIG-03/04 | `unknown-key` distinguished from `signature` |
| BAD-STR-*, TIME-*, REPLAY-*, BIND-* | structure/validity, time, replay and binding refusals |

**Key hygiene is non-negotiable.** Every private key in `keys/` is a published
test fixture, generated for the vector set, used nowhere else, and documented as
never having signed a real license. No production key — public or private — and
no key derived from a real issuance may appear. A real production private key in
a fixture is the exact failure the task prohibits; the secret-scan gate
([architecture §3.3](./owner-side-system-architecture.md)) must whitelist these
fixtures by path and fail on anything else.

## 6. Prerequisites, ordering and gates

Publishing the vector set is **not** a documentation-only act, because §5 step 5
adds a conformance test to the customer suite. It is also **not** unauthorized
work: two of its prerequisites are Product Owner decisions. The order and the
gate on each step are:

| Step | Work | Gate |
| --- | --- | --- |
| 1 | Ratify the §2.4 **proposal** as normative text in [`version-model-and-file-exchange.md`](./version-model-and-file-exchange.md) §2.1 and correct that section's `deviceLimit` omission (GAP-6). Documentation only; no behaviour change; every existing artifact still verifies. This is **Phase 0.5B**. | **Explicit Product Owner approval of D-2(b)** |
| 2 | Write the deterministic generator inside the existing backend test tree, reusing the real canonicalizers and the real error-reason strings. | D-2(a) = Option B, and step 1 complete |
| 3 | Commit the generated vectors and the conformance test. This is **Phase 1**. | as step 2 |
| 4 | Add the CI regeneration gate. | as step 2 |

Step 1 must precede steps 2–4: a vector that encodes **unratified** escaping
behaviour would silently make the D-2(b) decision by asserting bytes nobody
approved. That is precisely the failure mode this ordering prevents.

Steps 2–4 touch `backend/`, so they run the full backend CI job, not the
docs-only job. They are additive: no canonicalizer, no signed format, no
migration and no customer behaviour changes.

If the Product Owner prefers a *different* escaping rule (for example RFC 8785
JCS with `\uXXXX` for non-ASCII), that is a **format change** requiring a
versioned `VLIC3` and a U-8 backward-compatibility decision — it must not be made
silently inside this work, and steps 2–4 then cannot proceed until it is decided.

**Independently of all of the above**, the customer-package remediation of GAP-1
and GAP-2 (**Phase 0.5A**) requires no part of D-2, touches no contract text and
no vector, and may proceed on normal implementation authorization alone. It must
not be bundled into step 1.

## 7. What this document does not decide

Whether the shared protocol becomes a publishable package or stays as vectors
only (item **D-2(a)**); whether the measured canonical escaping behaviour is
ratified as normative contract text (item **D-2(b)** — §2.4 is a *proposal*, and
until it is approved the behaviour remains an undocumented artefact of Node's
`JSON.stringify`); whether a signed **refusal** artifact is introduced for denied
replacements (item D-8 — the implemented `VDRP1` carries `decision: 'APPROVE'`
only, and adding a refusal value changes a signed contract); whether `VDEA1`
enrollment vectors are consumed by the device client in this repository or an
external one (OQ-83 Phase 1, platform undecided); and anything about revocation,
reactivation, server-installation replacement or general activation receipts,
whose formats do not exist and whose product questions (OQ-78, OQ-82, OQ-84)
are OPEN.

It also does not touch the customer-package remediation of GAP-1/GAP-2
(**Phase 0.5A**), which needs no part of D-2 and is deliberately kept out of this
document's gates.
