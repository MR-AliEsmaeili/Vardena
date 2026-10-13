# Required-check enforcement — verified state and owner action

Status: **enforcement is NOT possible on the current repository plan** · Verified 2026-10-13
Repository: `MR-AliEsmaeili/Vardena` (private, personal account, GitHub Free)
Branch: `main` · Checked by: agent session on `arena/82042e47-vardena` (PR #145)

This document answers one question: **does the stable `ci-gate` check actually
protect merges to `main` (including documentation-only changes where the
backend/frontend jobs are intentionally skipped)?** It records what was read
from GitHub, what could not be read or changed, and the exact owner action that
resolves it. Nothing in this document is inferred from CI being green.

---

## 1. Verified state (read-only evidence)

| Question | Answer | Evidence |
| --- | --- | --- |
| Is `main` protected? | **No** | `GET /repos/MR-AliEsmaeili/Vardena/branches/main` → `{"name":"main","protected":false}`. Only the branch object's `protected` flag is needed for this (Contents: read), and it is readable. |
| Which status checks are required for `main`? | **None** — no rule exists, so nothing can block a merge | Same response; a required check requires a branch protection rule or a ruleset. |
| Is the detailed protection setting readable? | **No, not for this token** | `GET /repos/MR-AliEsmaeili/Vardena/branches/main/protection` → `403` `{"message":"Resource not accessible by integration"}`, with response header `X-Accepted-Github-Permissions: administration=read`. The token is a GitHub App installation token (`X-Oauth-Client-Id: Iv23lifFg4c9eT1T6hLC`) without the Administration permission. `required_status_checks` and the GraphQL `branchProtectionRules` field return the same 403. |
| Can the repository use rulesets instead? | **No, not on this plan** | `GET /repos/MR-AliEsmaeili/Vardena/rulesets` and `GET /repos/MR-AliEsmaeili/Vardena/rules/branches/main` → `403` `{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature."}` |
| Is `ci-gate` currently required? | **No** | Follows from the first row: with no protection rule and no ruleset, no check is required. `ci-gate` runs and passes on PR #145, but a green check is not an enforcement claim. |

### What is *not* claimed

* The 403 on `/protection` is a **token-permission** limitation. It says nothing
  about the repository beyond what the readable `protected: false` already says.
* No protection setting, secret, permission, visibility or billing setting was
  read beyond the endpoints above, and **none was changed** by this work.

### Consequence for pull requests today

`ci-gate`, `backend`, `frontend`, `generated-api-client`, `docs` and `classify`
are **advisory**. A pull request can be merged while any of them is failing,
skipped or still running, because nothing on the server requires them. The
safety properties of the change-aware pipeline (below) are therefore only as
strong as the merge discipline around them.

---

## 2. Why this cannot be configured from here

Two independent blockers, both outside this session's authority:

1. **Token scope — the setting is unreadable.** The GitHub App installation
   token used by this session has `contents: read`, `push`, etc. but not
   `Administration`, which is exactly the permission GitHub demands for
   branch-protection endpoints (`X-Accepted-Github-Permissions:
   administration=read`). A write attempt would fail the same way, and a write
   is not something this task is authorized to perform.
2. **Plan — even the owner cannot enable it while the repository stays private
   on Free.** Protected branches and repository rulesets are available for
   public repositories on GitHub Free, and for private repositories on GitHub
   Pro/Team/Enterprise. GitHub's API states this for rulesets explicitly
   ("Upgrade to GitHub Pro or make this repository public to enable this
   feature") and the same plan gate applies to classic branch protection for
   private repositories.

**Making the repository public is not a recommended workaround** and is out of
scope: it is a visibility change, not a CI change.

---

## 3. What the pipeline guarantees once enforcement exists

The workflow is built so that enforcement, when it becomes available, is safe
for documentation-only changes *and* still blocks untested code:

| Mechanism | Guarantee |
| --- | --- |
| No workflow-level `paths`/`paths-ignore` filtering | The workflow always starts, so required checks can never sit "Pending" because the workflow was skipped entirely. |
| Job-level conditions | A job that is not applicable is skipped; GitHub reports a skipped job as **success**, so requiring `docs`/`backend`/`frontend`/`generated-api-client` does not deadlock a documentation-only pull request. |
| `ci-gate` (`if: always()`) | Fails when the classifier did not succeed, when a job the classifier marked applicable did not reach `success` — **including a skipped, cancelled or missing job** — when an unrequired job failed, or when the classification claims no job applies. It cannot be skipped, so it cannot silently pass. |
| Self-weakening guard (`--also-run-rev`) | The classifier revision already accepted on `main` re-evaluates the same change set and its decision is **unioned** in, so a pull request cannot narrow its own verification by shipping a weakened classifier. If that authoritative classifier exists but cannot be executed, every job runs (fail-closed). |
| Per-job checks required as well | A single hollowed-out script cannot unlock a merge, and deleting a job from the workflow leaves its check permanently unreported — GitHub then blocks the merge instead of silently dropping the coverage. |

---

## 4. Owner action (choose one)

### Option A — recommended: enable enforcement, keep the repository private

**A1. Upgrade the personal account to GitHub Pro** (Settings → Billing and
licensing → Plans and usage → Upgrade). This is what unlocks protected branches
and required status checks for a private repository on a personal account. No
other repository setting needs to change.

**A2. Wait for the checks to have run at least once** (already true: the six
checks ran on PR #145's commits). GitHub's required-check picker only offers
checks that have reported successfully in the repository during the last 7 days.

**A3. Create the rule — UI path (classic branch protection):**

1. Open `https://github.com/MR-AliEsmaeili/Vardena/settings/branches`.
2. Under **Branch protection rules**, choose **Add branch protection rule**
   (2026 UI: **Add rule**).
3. **Branch name pattern**: `main`.
4. Enable **Require a pull request before merging** if you want the review
   contract enforced too (optional; recommended).
5. Enable **Require status checks to pass before merging**.
6. In the search field type each of these names and add it:
   `ci-gate`, `backend`, `frontend`, `generated-api-client`, `docs`
   (optionally also `classify`).
7. Optionally enable **Require branches to be up to date before merging**
   (safest; costs an extra CI run after every `main` advance).
8. Recommended: enable **Do not allow bypassing the above settings**, otherwise
   administrators (including you) bypass the rule and merges stay ungated.
9. **Create** / **Save changes**.

Rulesets are an equivalent alternative if the account has them
(**Settings → Rules → Rulesets → New ruleset → Branch ruleset**, target `main`,
add the same required checks, set the ruleset to **Active**). GitHub returned a
plan error for rulesets on this repository, so on GitHub Free the classic path
above is the one that exists after upgrading.

**A4. Create the rule — API path (equivalent, for an admin token):**

```bash
cat > /tmp/vardena-protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "ci-gate"},
      {"context": "backend"},
      {"context": "frontend"},
      {"context": "generated-api-client"},
      {"context": "docs"}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 1},
  "restrictions": null
}
JSON

gh api -X PUT repos/MR-AliEsmaeili/Vardena/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input /tmp/vardena-protection.json
```

**A5. Verify the rule (required):**

```bash
scripts/check-required-checks.py          # exit 0 = every policy check enforced
gh api repos/MR-AliEsmaeili/Vardena/branches/main/protection \
  --jq '.required_status_checks.checks[].context'
```

Expected: the five (or six) names, `enforce_admins.enabled: true`, and
`protected: true` from `GET /branches/main`. `scripts/check-required-checks.py`
reports the plan gate, a permission failure and a missing rule as three distinct
answers, and exits non-zero when enforcement cannot be confirmed.

### Option B — keep the repository private on Free (advisory CI only)

Nothing can block a merge server-side. Compensating controls, in order of value:

1. **Treat the `ci-gate` check on the pull request as a manual gate**: do not
   merge while it is missing, failing or not yet reported.
2. **Review the changed-file list against the classifier decision** in the
   `classify` job summary (the step summary records the decision, the base
   revision and the previous-revision union).
3. Re-run `scripts/check-required-checks.py` after any plan change, and record
   the result in `STATE.md`.
4. Keep direct pushes to `main` out of the workflow: every change lands through
   a pull request whose CI ran on the exact head SHA (this is already the
   repository's process in `.vardena/agent-rules.md` AG-02).

### Option C — not recommended

Making the repository public would enable protection on GitHub Free, but it is
a visibility change with licensing/IP consequences and is explicitly out of
scope for this task.

---

## 5. Verification of the pipeline itself (independent of enforcement)

```bash
python3 -m unittest discover -s scripts/tests -t scripts/tests   # CI helper suite
python3 scripts/check-ci-workflow.py                             # workflow invariants
```

The suite covers the classification matrix, the gate contract (a skipped,
cancelled or failed required job fails the gate), the self-weakening guard
(including the weakening scenario it exists for), the workflow wiring
(no `paths` filters, `if: always()` gate, gate `needs`, guard invocation) and
the enforcement-verifier interpretations.

---

## 6. Open questions for the Owner

* **BOOT-OQ-04** ("which CI jobs are actually required by branch protection?"):
  now answered for the current state — **none**, and enforcement is not
  available on the current plan. It becomes actionable again after Option A.
* Decide whether a pull request approval requirement (A3 step 4) should be part
  of the rule, since the repository's lifecycle expects Owner review before
  merge.
* Decide whether `strict` (branches up to date before merging) is worth the
  extra CI runs.
