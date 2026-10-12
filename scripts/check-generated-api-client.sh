#!/usr/bin/env bash
# F-7: regenerate frontend/src/api/generated/vardena-api.d.ts from the OpenAPI
# document produced by THIS checkout and fail if the committed client differs.
#
# Prerequisites (from a clean checkout):
#   - Node 22+, npm 11
#   - backend: npm ci, npm run prisma:generate, npm run build
#   - frontend: npm ci
#   - DATABASE_URL set (config validation only; dump does not query Postgres)
#
# Usage (repository root):
#   ./scripts/check-generated-api-client.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
openapi="${tmp}/vardena-openapi.json"

cd "$root/backend"
npm run openapi:dump -- "$openapi"

cd "$root/frontend"
VARDENA_OPENAPI_SOURCE="$openapi" npm run api:types

cd "$root"
if ! git diff --exit-code HEAD -- frontend/src/api/generated/vardena-api.d.ts; then
  echo "Generated API client is stale. Run:" >&2
  echo "  (cd backend && npm run build && npm run openapi:dump -- /tmp/vardena-openapi.json)" >&2
  echo "  (cd frontend && VARDENA_OPENAPI_SOURCE=/tmp/vardena-openapi.json npm run api:types)" >&2
  echo "and commit frontend/src/api/generated/vardena-api.d.ts." >&2
  exit 1
fi
