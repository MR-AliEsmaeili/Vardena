# Owner Persian RTL UI

See [the independent Owner README](../README.md). The browser uses a relative
same-origin API URL and receives only safe DTOs. It stores no session token,
password, private key or business record in localStorage/sessionStorage.

## Session and credential failures

`POST /api/v1/auth/change-password` answers 401 `Unauthorized` for **two**
different facts: the session has ended, or the submitted current password was
rejected ("Invalid current password."). The transport layer therefore classifies
that route as an _expected_ 401 (`src/api/client.ts`,
`expectedUnauthorizedPaths`) instead of an ended session, and the page asks the
session which fact applies (`SessionProvider.verifySessionAlive`, which re-reads
`GET /auth/me`):

- the probe answers with the current user → the attempt is reported as a rejected
  current password (`t.auth.currentPasswordInvalid`) and the operator stays on the
  form, with the field marked invalid;
- the probe answers 401 → the session really ended: the local session and every
  cached server value are cleared, and the operator is sent to `/login` with the
  expiry notice;
- the probe fails otherwise (network, 5xx) → neither cause is stated
  (`t.errors.unauthorized`) and nothing is cleared, because a transport failure
  proves nothing.

A 401 from any session-gated request (`/customers`, `/users`,
`/operational-records`, `/audit-events`, `/permissions/effective`) still means an
ended session and still clears the cached values. No status code is ever reported
as "your session expired" without that check, and the server remains the only
authority on session validity.

Tests: `src/api/client.test.ts` (pure: which requests are expected 401s) and
`src/features/auth/change-password-page.test.tsx` (flow: the three outcomes).

## Audit explorer

The audit page (`/app/audit`) is available only with `audit.view`. Without it the
page shows the forbidden message and sends no request.

- **Filters**: event code (exact, with suggestions from the known codes), actor
  id, target type, target id, outcome, and a from/to UTC calendar-day range. The
  event code and identifiers are checked before a request is sent, and each
  rejection explains itself in Persian. The range is inclusive of both days and
  is interpreted in UTC. Dates must be real calendar days in years 1000 or later,
  matching the backend; a year before 1000 gets its own message. `to` cannot be
  9999-12-31: its exclusive end would be year 10000, which the four-digit-year
  contract cannot express. The form rejects that day with its own message and
  never drops the bound.
- **Apply and reset**: nothing is queried while the user types. Apply writes the
  applied filters to the URL and returns to page one. Reset clears the draft and
  removes every filter parameter from the URL. Browser back and forward and deep
  links reproduce the same query.
- **URL state**: a URL the backend would reject is not sent to the API. That
  covers a malformed identifier or value, a parameter repeated (`?eventType=A&eventType=B`),
  an unknown parameter (such as a typo like `?actor=`), and a malformed `page`
  (`page=abc`, `page=0`, `page=`). A filter value with leading or trailing
  whitespace is also refused, whether typed raw or percent-encoded (`%20`, `+`):
  trimming it would query something other than the URL states. Draft values are
  trimmed when the user applies them, so the URL the page writes is canonical.
  The page says the filters are invalid. It never shows unfiltered rows under a
  URL that names filters, and never falls back silently to page one.
- **States**: loading, empty ("no results" for filtered queries), error with a
  retry action, and forbidden are each rendered explicitly.
- **Pagination**: backend pages only. Next is enabled when the response says
  `hasNext`. Changing a filter resets the page; paging keeps an unapplied draft.
- **Trail links**: an operational record and a customer detail page link to their
  exact audit trail when the user has `audit.view`.
- **Observations**: observation events show the note that they record an operator
  observation. The copy never presents them as cryptographic verification,
  signing, or contact with the customer server.

Code: `src/features/audit/` (`audit-page.tsx`, `audit-filters.ts` for URL and UTC
mapping, `audit-filter-schema.ts` for client validation). Query keys are in
`src/api/query-keys.ts`; the API client is the existing `src/api/owner.api.ts`.
Tests: `audit-filters.test.ts` (pure) and `audit-page.test.tsx` (flow).
