# Owner Persian RTL UI

See [the independent Owner README](../README.md). The browser uses a relative
same-origin API URL and receives only safe DTOs. It stores no session token,
password, private key or business record in localStorage/sessionStorage.

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
