# Upstream provenance — UI UX Pro Max (vendored)

This directory is a **vendored, unmodified-in-substance copy** of the
[UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) skill
(MIT — see `LICENSE` in this folder), pinned for offline use inside Vardena.

| Field | Value |
| --- | --- |
| Upstream repository | `nextlevelbuilder/ui-ux-pro-max-skill` |
| Pinned version | `2.15.0` (`skill.json` in this folder) |
| Pinned commit | `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` (2026-10-26) |
| Vendored path | `.claude/skills/ui-ux-pro-max/` |
| Runtime requirements | Python 3.x, standard library only, no network calls |

## Local adaptations (re-apply after every update)

1. `SKILL.md`: invocation paths `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py`
   → `.claude/skills/ui-ux-pro-max/scripts/search.py` (repo-relative).
2. `SKILL.md`: the section **"Vardena Project Overlay (read first)"** was added
   after the intro. Keep it; the full contract lives in
   `docs/frontend/ui-ux-pro-max.md`.
3. `LICENSE` and `skill.json` were copied in from the upstream root for
   attribution and version pinning.

## Update procedure

1. Fetch the desired upstream tag/commit and copy
   ` .claude/skills/ui-ux-pro-max/ ` (SKILL.md, data/, scripts/, references/)
   over this directory (keep `UPSTREAM.md`).
2. Re-apply the two `SKILL.md` adaptations above.
3. Refresh this table (version + commit) and the pin noted in
   `docs/frontend/ui-ux-pro-max.md`.
4. Smoke-test offline:
   `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "internal operations dashboard" --design-system --density 8`
5. Owner decision is required for anything that would change Vardena's visual
   rules — the skill is advisory and never supersedes
   `docs/frontend/standards.md` (see `docs/frontend/ui-ux-pro-max.md`).
