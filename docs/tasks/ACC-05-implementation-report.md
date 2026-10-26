# ACC-05 — Account ↔ Detail Group unlink (in-progress)

**Date:** 2026-10-26 · **Status:** PARTIAL pending final cross-task verification and OQ-95.

- Added the existing `POST /accounts/:id/unlink-detail-group` endpoint and exact `Accounting.Account.UnlinkDetailGroup` UI permission. The mutation sends **only** `{ confirmUnlink: true }` after an explicit checked acknowledgement; there is no call before the box is checked. Query invalidation refreshes the account list/detail and chart tree.
- The destructive confirmation displays the **verbatim** backend `ACCOUNT_DETAIL_UNLINK_WARNING` in `t.accountAdmin.unlinkWarning`:

  > این تغییر باعث حذف ارتباط بین تفصیلی و کد حساب می‌شود و تمامی گردش‌های تفصیلی در سندهایی که کدحساب مدنظر گردش داشته باشد حذف خواهد شد . قبل از انجام این کار از دیتا بیس بکاپ بگیرید

- The action appears only when `detailGroupId !== null` and the exact unlink permission is held. The linked group's name is resolved through the independently permission-gated Detail.View endpoint. If unavailable, it is labelled unavailable instead of leaking an ID or requesting a forbidden endpoint; [OQ-95](../decisions/product/OQ-95-account-admin-cross-permission-reference-ux.md) asks the owner to decide whether this fallback is acceptable.
- Focused tests cover action visibility, acknowledgement, exact body, rejection keeping the dialog open, successful server-state refresh, and invalidation. No backend or generated OpenAPI file was changed.

## Test execution matrix

| Gate | Environment | Result |
| --- | --- | --- |
| Account detail and mutation hooks | FAST-LOCAL | Passed focused Vitest; see PR/checkpoint output |
| Frontend full typecheck/lint/format/test/build and docs/date guards | FAST-LOCAL | Passed: 749 tests / 106 files, build, date guard and 1,337 documentation links (0 broken) |
| Browser E2E and applicable pipeline jobs | CI-HEAVY | PR #213 passed at 3c75a83; draft combined PR #214 checkpoint run `40298057735` passed at `ef1df77` (docs/frontend/generated/browser E2E/ci-gate; backend and Windows skipped). Final combined PR CI remains pending. |

No heavy E2E/live-DB test was executed locally unless explicitly authorized.
