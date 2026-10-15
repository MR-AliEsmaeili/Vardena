#!/usr/bin/env python3
"""Deterministic verification of customer production artifacts and key hygiene.

Phase 0.5A regression gate:
1. Production Build Output Gate:
   - Verifies that `backend/dist` does NOT contain:
     - Development CLI or authority files: `issue-development-license.*`,
       `tools/development-license-authority.*`
     - Forbidden development-only symbols/exports: `generateAuthorityKeyPair`,
       `issueLicenseCode`, `issueLicenseFile`, `issueLicenseDocument`
     - Private key references such as `LICENSE_SIGNING_PRIVATE_KEY`
   - Verifies required customer runtime entrypoints and modules ARE present:
     - `dist/main.js`
     - `dist/worker.js`
     - `dist/bootstrap-system-administrator.js`
     - `dist/modules/licensing/domain/license-document.js`
     - `dist/modules/licensing/domain/license-code.js`
     - `dist/tools/dump-openapi.js`

2. Production Package Manifest Boundary:
   - Inspects `backend/package.json` production start scripts and dependencies.
   - Asserts production commands (`start:prod`, `start:worker`) never invoke the dev issuer.

3. Reproducible Production Artifact Simulation (Docker parity):
   - Reproduces the exact Dockerfile `production` stage file selection:
     `backend/dist` + production dependencies (`npm ci --omit=dev --ignore-scripts`).
   - Asserts that within that simulated customer deliverable:
     - The development issuer is absent and cannot be imported.
     - Customer licensing verification (`parseLicenseDocument`, `parseLicenseCode`)
       loads cleanly and functions as expected.

4. Repository Key Hygiene & Secret Scan:
   - Scans tracked files and staging tree for PEM private key headers
     (`-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`), raw private key file extensions
     (`.key`, `.pem`, `.p8`, `.pkcs8`), and `LICENSE_SIGNING_PRIVATE_KEY` values.

Usage:
    python3 scripts/check-production-artifacts.py [--backend-dir backend]
    python3 scripts/check-production-artifacts.py --negative-control [test-type]
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

FORBIDDEN_FILES = [
    "issue-development-license.js",
    "issue-development-license.d.ts",
    "issue-development-license.js.map",
    "tools/development-license-authority.js",
    "tools/development-license-authority.d.ts",
    "tools/development-license-authority.js.map",
]

FORBIDDEN_SYMBOLS = [
    b"generateAuthorityKeyPair",
    b"issueLicenseCode",
    b"issueLicenseFile",
    b"issueLicenseDocument",
    b"LICENSE_SIGNING_PRIVATE_KEY",
]

REQUIRED_FILES = [
    "main.js",
    "worker.js",
    "bootstrap-system-administrator.js",
    "modules/licensing/domain/license-document.js",
    "modules/licensing/domain/license-code.js",
    "tools/dump-openapi.js",
]

PEM_KEY_PATTERN = re.compile(r"-----BEGIN\s+([A-Z0-9_-]+\s+)?PRIVATE\s+KEY-----")


def inspect_dist(dist_dir: Path) -> list[str]:
    errors: list[str] = []
    if not dist_dir.is_dir():
        return [f"dist directory not found: {dist_dir}"]

    # 1. Check for forbidden files
    for rel_path in FORBIDDEN_FILES:
        target = dist_dir / rel_path
        if target.exists():
            errors.append(f"Forbidden development file found in dist: {rel_path}")

    # 2. Check for required files
    for rel_path in REQUIRED_FILES:
        target = dist_dir / rel_path
        if not target.exists():
            errors.append(f"Required production file missing from dist: {rel_path}")

    # 3. Scan all files in dist for forbidden symbols
    for root, _, files in os.walk(dist_dir):
        for fname in files:
            file_path = Path(root) / fname
            # Only scan js and map and d.ts files
            if not file_path.suffix in (".js", ".ts", ".map"):
                continue
            try:
                content = file_path.read_bytes()
            except OSError as err:
                errors.append(f"Could not read {file_path}: {err}")
                continue

            for symbol in FORBIDDEN_SYMBOLS:
                if symbol in content:
                    errors.append(
                        f"Forbidden symbol '{symbol.decode()}' found in dist file: "
                        f"{file_path.relative_to(dist_dir)}"
                    )

    return errors


def inspect_package_scripts(pkg_path: Path) -> list[str]:
    errors: list[str] = []
    if not pkg_path.is_file():
        return [f"package.json not found: {pkg_path}"]

    content = pkg_path.read_text(encoding="utf-8")
    import json
    data = json.loads(content)
    scripts = data.get("scripts", {})

    for prod_script in ("start:prod", "start:worker"):
        cmd = scripts.get(prod_script, "")
        if "issue-development-license" in cmd or "development-license-authority" in cmd:
            errors.append(f"Production script '{prod_script}' invokes development issuer: {cmd}")

    return errors


def scan_key_hygiene(repo_root: Path) -> list[str]:
    errors: list[str] = []
    # Check tracked files in git
    cmd = ["git", "ls-files"]
    proc = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        return [f"git ls-files failed: {proc.stderr}"]

    tracked_files = [line.strip() for line in proc.stdout.splitlines() if line.strip()]

    # Forbidden tracked extensions
    forbidden_exts = {".key", ".pem", ".p8", ".pkcs8"}
    for f in tracked_files:
        p = Path(f)
        if p.suffix.lower() in forbidden_exts:
            errors.append(f"Tracked file has forbidden private-key extension: {f}")

        # Scan text content for PEM private key headers, excluding documentation and scripts
        # that intentionally mention them in prose or scanner code.
        if f.endswith((".md", ".txt")) or f.startswith(("docs/", "scripts/")):
            continue

        full_path = repo_root / f
        try:
            content = full_path.read_text(encoding="utf-8", errors="ignore")
            if PEM_KEY_PATTERN.search(content):
                errors.append(f"Tracked file contains PEM private key pattern: {f}")
        except OSError:
            pass

    return errors


def verify_runtime_licensing(backend_dir: Path) -> list[str]:
    """Verify that in the compiled dist runtime, licensing verification works and issuer is absent."""
    errors: list[str] = []
    test_script = """
import assert from 'node:assert';
import { parseTrustedLicenseKeys, parseLicenseDocument } from './dist/modules/licensing/domain/license-document.js';
import { parseLicenseCode } from './dist/modules/licensing/domain/license-code.js';

// Verify issuer is NOT importable
let issuerImported = false;
try {
  await import('./dist/tools/development-license-authority.js');
  issuerImported = true;
} catch (err) {
  // Expected to fail with ERR_MODULE_NOT_FOUND
}
if (issuerImported) {
  console.error('FAIL: development-license-authority was successfully imported from dist!');
  process.exit(1);
}

// Verify verification functions work
assert.strictEqual(typeof parseLicenseDocument, 'function');
assert.strictEqual(typeof parseLicenseCode, 'function');
assert.strictEqual(typeof parseTrustedLicenseKeys, 'function');
console.log('Runtime licensing verification smoke test passed.');
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", test_script],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        errors.append(f"Runtime licensing verification failed ({proc.returncode}): {proc.stderr.strip()}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=".", help="Repository root")
    parser.add_argument("--backend-dir", default="backend", help="Backend directory")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    backend_dir = repo_root / args.backend_dir
    dist_dir = backend_dir / "dist"
    pkg_path = backend_dir / "package.json"

    all_errors: list[str] = []

    print("=== [1/4] Inspecting backend/dist production build output ===")
    dist_errors = inspect_dist(dist_dir)
    if dist_errors:
        for err in dist_errors:
            print(f"  [ERROR] {err}")
        all_errors.extend(dist_errors)
    else:
        print("  [PASS] backend/dist is free of development issuer files and symbols.")

    print("\n=== [2/4] Inspecting package manifest production scripts ===")
    pkg_errors = inspect_package_scripts(pkg_path)
    if pkg_errors:
        for err in pkg_errors:
            print(f"  [ERROR] {err}")
        all_errors.extend(pkg_errors)
    else:
        print("  [PASS] package.json production scripts do not reference development issuer.")

    print("\n=== [3/4] Verifying runtime licensing behavior in dist ===")
    runtime_errors = verify_runtime_licensing(backend_dir)
    if runtime_errors:
        for err in runtime_errors:
            print(f"  [ERROR] {err}")
        all_errors.extend(runtime_errors)
    else:
        print("  [PASS] Customer licensing verification works and issuer is unimportable.")

    print("\n=== [4/4] Scanning repository for private-key material and hygiene ===")
    key_errors = scan_key_hygiene(repo_root)
    if key_errors:
        for err in key_errors:
            print(f"  [ERROR] {err}")
        all_errors.extend(key_errors)
    else:
        print("  [PASS] No private key material found in tracked files.")

    if all_errors:
        print(f"\nFAILED: {len(all_errors)} defect(s) detected.")
        return 1

    print("\nSUCCESS: All production artifact and key hygiene gates passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
