# OQ-95 — Reference-data visibility for Account.Create and Account.UnlinkDetailGroup

- **Type:** Product/access-policy question
- **Status:** OPEN — owner decision required
- **Created:** 2026-10-26
- **Owner:** Ali Esmaeili
- **Related:** ACC-04, ACC-05; `backend/src/modules/accounting/api/accounts.controller.ts`, `accounting-configurations.controller.ts`, `details.controller.ts`

## Observed contract

`POST /accounts` requires only `Accounting.Account.Create`. The optional account-parent picker reads `GET /accounts` (`Accounting.Account.View`), the code-pattern hint reads `GET /accounting-configurations/active` (`Accounting.AccountingConfiguration.View`), and the Detail Group picker reads `GET /details` (`Accounting.Detail.View`). Similarly `POST /accounts/:id/unlink-detail-group` requires `Accounting.Account.UnlinkDetailGroup`, while resolving the linked group's *name* with `GET /details/:id` requires `Accounting.Detail.View`. The backend does **not** impose any of these read permissions as prerequisites for those write operations. The archive asks for an independent Create-only route and for the group name in the destructive confirmation dialog; it does not decide what to show for users lacking those independent read grants.

## Decision requested

Should the standard administrative role grant all the relevant read permissions together with Account.Create / UnlinkDetailGroup, or should the product support a least-privilege write-only experience? If write-only is required, is a root account created with a manually entered *full* code and backend validation acceptable without revealing the active code-pattern hint? For unlink, is a warning with the account code and an explicitly unavailable group name acceptable when the operator lacks Detail.View, or is the group name a mandatory prerequisite (requiring a backend authorization/design change)?

## Interim, non-authoritative UI behavior

The route stays authorized by the exact backend permission alone. Where reference reads are authorized, show the rich parent/structure/group pickers and the group's name. For Create-only without the independent reads, permit a root POST using the backend's `code` input and let the server validate it; no unauthorized GET is sent. For Unlink-only without Detail.View, show the exact contractual warning and acknowledgement checkbox with a clear "name unavailable" placeholder; the server still controls the mutation. Do **not** grant implicit read access, invent an endpoint, or claim this resolves the product/access-policy question. A product decision may require a follow-up UX/backend change.
