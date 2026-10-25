#!/usr/bin/env python3
"""Deterministic verification of customer production artifacts, Docker stage file parity, and key hygiene.

Phase 0.5A regression gate:
1. Production Build Output Gate:
   - Verifies that `backend/dist` exists and does NOT contain:
     - Offline issuer/key files: `issue-development-license.*`,
       `tools/development-license-authority.*`,
       `tools/developer-license-key-files.*`
     - Forbidden development-only symbols/exports: `generateAuthorityKeyPair`,
       `issueLicenseCode`, `issueLicenseFile`, `issueLicenseDocument`,
       `LICENSE_SIGNING_PRIVATE_KEY`
   - Verifies required customer runtime entrypoints and modules are present as compiled files:
     - `dist/main.js`
     - `dist/worker.js`
     - `dist/bootstrap-system-administrator.js`
     - `dist/modules/licensing/domain/license-document.js`
     - `dist/modules/licensing/domain/license-code.js`
     - `dist/tools/dump-openapi.js`

2. Production Package Manifest Boundary:
   - Inspects `backend/package.json` production start scripts.
   - Asserts production commands (`start:prod`, `start:worker`) never invoke the dev issuer.

3. Reproducible Production Stage File-Selection Simulation (Docker Production Stage Parity):
   - Reproduces the file-selection boundary corresponding to `backend/Dockerfile` production stage:
     ```dockerfile
     COPY package.json package-lock.json ./
     COPY --from=build /app/dist ./dist
     ```
   - In a hermetic directory structure, copies `package.json`, `package-lock.json`, and `dist/`.
   - Asserts that within that simulated customer deliverable:
     - Development issuer files are absent and unimportable.
     - Required entrypoint files exist.
     - Real customer license verification works using authoritative test fixtures:
       - Valid `VLIC2` document envelope parses and verifies against trusted public key.
       - Valid `VLIC1` legacy code parses and verifies against trusted public key.
       - Tampered signature or untrusted public key is strictly refused.
   - Note on Scope/Limitation: This check simulates the Dockerfile production stage's file selection
     and verifies runtime licensing behavior. It does not invoke the Docker daemon to build a live
     container image and does not run `npm ci --omit=dev` inside the sandbox.

4. Repository Key Hygiene & Secret Scan:
   - Scans tracked git files and any staged files for forbidden private-key extensions
     (`.key`, `.pem`, `.p8`, `.pkcs8`) and PEM private key headers
     (`-----BEGIN [A-Z0-9_-]+ PRIVATE KEY-----`).
   - Exclusions are minimal, explicit, and bounded:
     - Documentation files (`.md`, `.txt`) discussing licensing requirements.
     - The explicit scanner files containing the detection regular expressions
       (`scripts/check-production-artifacts.py` and its test `scripts/tests/test_ci_scripts.py`).
     - All other scripts and files under `scripts/`, `backend/`, `frontend/`, etc., are scanned.

Usage:
    python3 scripts/check-production-artifacts.py [--repo-root .] [--backend-dir backend]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FORBIDDEN_FILES = [
    "issue-development-license.js",
    "issue-development-license.d.ts",
    "issue-development-license.js.map",
    "tools/development-license-authority.js",
    "tools/development-license-authority.d.ts",
    "tools/development-license-authority.js.map",
    "tools/developer-license-key-files.js",
    "tools/developer-license-key-files.d.ts",
    "tools/developer-license-key-files.js.map",
]

FORBIDDEN_SYMBOLS = [
    b"generateAuthorityKeyPair",
    b"issueLicenseCode",
    b"issueLicenseFile",
    b"issueLicenseDocument",
    b"assertDeveloperKeyPathPrivate",
    b"DeveloperKeyFileError",
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

# Authoritative test vectors for licensing verification
FIXTURE_PUBLIC_KEY = "MCowBQYDK2VwAyEAuVl0W2qUWfI1L7SsbF+OOcoCU6BDNWS5cAivYfFrC34="
FIXTURE_VLIC2_FILE = (
    '{\n'
    '  "format": "vardena-license",\n'
    '  "fileVersion": 1,\n'
    '  "document": "VLIC2.eyJ2IjoyLCJraW5kIjoiU0VSVkVSX0xJQ0VOU0VfVkVSU0lPTiIsIm9wZXJhdGlvbklkIjoiMDFNNFpHRU5TMEU2VktHU1JESzhOWVBGTVQiLCJsaWNlbnNlSWQiOiIwMU00WkdFTlJaQVFXVzIwMDROM05SQUhNOSIsImN1c3RvbWVySWQiOiIwMUs3Q1VTVE9NRVIwMDAwMDAwMDAwMDAwMCIsImN1c3RvbWVyQ29kZSI6IkNVU1QtQUNNRS0wMSIsImN1c3RvbWVyTmFtZSI6IkFjbWUgQ29ycCIsImluc3RhbGxhdGlvbklkIjoiMDFLN0lOU1RBTExBVElPTjAwMDAwMDAwMDAiLCJzdGF0dXMiOiJBQ1RJVkUiLCJ2YWxpZEZyb20iOiIyMDIwLTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJ2YWxpZFVudGlsIjpudWxsLCJvcmdhbml6YXRpb25MaW1pdCI6NSwidXNlckxpbWl0Ijo1MCwiZGV2aWNlTGltaXQiOjEwLCJtb2R1bGVzIjpbImFjY291bnRpbmciLCJkb2N1bWVudHMiLCJpbnZlbnRvcnkiLCJvcmdhbml6YXRpb24iLCJyYmFjIiwidXNlcnMiLCJ3b3JrZmxvdyJdLCJmZWF0dXJlcyI6W10sInN1cGVyc2VkZXNPcGVyYXRpb25JZCI6bnVsbCwiaXNzdWVkQXQiOiIyMDI2LTEwLTE1VDEwOjA2OjQ4LjA5NloifQ.np7GH_MMEekBLH_bff3YoCfBkFlxJ1LiQWL1Ea8_q7MU2BnwEcyewicQq82_3mNrfJ9xTWPQbxWY2WQ4qEf_Bg"\n'
    '}'
)
FIXTURE_VLIC1_CODE = (
    "VLIC1.eyJ2IjoxLCJsaWNlbnNlSWQiOiIwMU00WkdFTlMyN0hYR0RBMERUSlpOMjhLNiIsImN1c3RvbWVySWQiOiIwMUs3Q1VTVE9NRVIwMDAwMDAwMDAwMDAwMCIsImN1c3RvbWVyQ29kZSI6IkNVU1QtQUNNRS0wMSIsImN1c3RvbWVyTmFtZSI6IkFjbWUgQ29ycCIsImluc3RhbGxhdGlvbklkIjoiMDFLN0lOU1RBTExBVElPTjAwMDAwMDAwMDAiLCJzdGF0dXMiOiJBQ1RJVkUiLCJ2YWxpZEZyb20iOiIyMDIwLTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJ2YWxpZFVudGlsIjpudWxsLCJvcmdhbml6YXRpb25MaW1pdCI6NSwidXNlckxpbWl0Ijo1MCwibW9kdWxlcyI6WyJhY2NvdW50aW5nIiwiZG9jdW1lbnRzIiwiaW52ZW50b3J5Iiwib3JnYW5pemF0aW9uIiwicmJhYyIsInVzZXJzIiwid29ya2Zsb3ciXSwiZmVhdHVyZXMiOltdfQ.EQ0_spCOoQmc8fKm7vNqcAQUyTWoc57KE_O9PXePhoUnJ3OqSriShV_AmUvZ6SuWPP4UjQjakKDCtWNCL5DLDA"
)

EXCLUDED_FROM_PEM_SCAN = {
    "scripts/check-production-artifacts.py",
    "scripts/tests/test_ci_scripts.py",
}


def inspect_dist(dist_dir: Path) -> list[str]:
    errors: list[str] = []
    if not dist_dir.is_dir():
        return [f"dist directory not found: {dist_dir} (artifact was not built)"]

    for rel_path in FORBIDDEN_FILES:
        target = dist_dir / rel_path
        if target.exists():
            errors.append(f"Forbidden development file found in dist: {rel_path}")

    for rel_path in REQUIRED_FILES:
        target = dist_dir / rel_path
        if not target.exists():
            errors.append(f"Required production file missing from dist: {rel_path}")

    for root, _, files in os.walk(dist_dir):
        for fname in files:
            file_path = Path(root) / fname
            if file_path.suffix not in (".js", ".ts", ".map"):
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

    try:
        content = pkg_path.read_text(encoding="utf-8")
        data = json.loads(content)
    except Exception as err:
        return [f"Could not parse package.json: {err}"]

    scripts = data.get("scripts", {})

    for prod_script in ("start:prod", "start:worker"):
        cmd = scripts.get(prod_script, "")
        if "issue-development-license" in cmd or "development-license-authority" in cmd or "dist-tools" in cmd:
            errors.append(f"Production script '{prod_script}' invokes development issuer: {cmd}")

    return errors


def execute_customer_license_verification(runtime_dir: Path) -> list[str]:
    """Execute cryptographic verification tests against the customer runtime deliverable."""
    errors: list[str] = []
    test_script = f"""
import assert from 'node:assert';
import {{ parseTrustedLicenseKeys, parseLicenseDocument, decodeLicenseTransport }} from './dist/modules/licensing/domain/license-document.js';
import {{ parseLicenseCode }} from './dist/modules/licensing/domain/license-code.js';

// 1. Assert issuer is completely unimportable
let issuerImported = false;
try {{
  await import('./dist/tools/development-license-authority.js');
  issuerImported = true;
}} catch (err) {{
  // Expected ERR_MODULE_NOT_FOUND
}}
if (issuerImported) {{
  console.error('FAIL: development-license-authority was successfully imported from dist!');
  process.exit(1);
}}

// 2. Test authentic VLIC2 verification using real trusted key and signature
const trustedKeys = parseTrustedLicenseKeys(['{FIXTURE_PUBLIC_KEY}']);
const decoded = decodeLicenseTransport({json.dumps(FIXTURE_VLIC2_FILE)});
const parsedV2 = parseLicenseDocument(decoded.document, trustedKeys);

assert.strictEqual(parsedV2.payload.customerCode, 'CUST-ACME-01');
assert.strictEqual(parsedV2.payload.customerId, '01K7CUSTOMER00000000000000');
assert.strictEqual(parsedV2.payload.installationId, '01K7INSTALLATION0000000000');
assert.strictEqual(parsedV2.payload.userLimit, 50);
assert.strictEqual(parsedV2.payload.organizationLimit, 5);
assert.strictEqual(parsedV2.payload.deviceLimit, 10);
assert.strictEqual(parsedV2.payload.status, 'ACTIVE');

// 3. Test authentic legacy VLIC1 verification
const parsedV1 = parseLicenseCode('{FIXTURE_VLIC1_CODE}', [trustedKeys[0].key]);
assert.strictEqual(parsedV1.customerCode, 'CUST-ACME-01');
assert.strictEqual(parsedV1.customerId, '01K7CUSTOMER00000000000000');
assert.strictEqual(parsedV1.userLimit, 50);
assert.strictEqual(parsedV1.organizationLimit, 5);
assert.strictEqual(parsedV1.status, 'ACTIVE');

// 4. Test cryptographic signature rejection on tampered document
let tamperedCaught = false;
try {{
  parseLicenseDocument(decoded.document + 'tamper', trustedKeys);
}} catch (e) {{
  tamperedCaught = true;
}}
assert.strictEqual(tamperedCaught, true, 'Tampered VLIC2 document signature must be rejected');

// 5. Test rejection on untrusted authority key
const untrustedKeys = parseTrustedLicenseKeys(['MCowBQYDK2VwAyEAr6GR+pcO30d+A8MK3UTBBh+xCP0EncNj4hPCjLOE0sM=']);
let untrustedCaught = false;
try {{
  parseLicenseDocument(decoded.document, untrustedKeys);
}} catch (e) {{
  untrustedCaught = true;
}}
assert.strictEqual(untrustedCaught, true, 'VLIC2 signed by untrusted authority must be rejected');

console.log('Customer license verification tests PASSED.');
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", test_script],
        cwd=str(runtime_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        errors.append(f"Customer license verification failed ({proc.returncode}): {proc.stderr.strip()}")
    return errors


def verify_docker_production_stage_parity(backend_dir: Path) -> list[str]:
    """Simulate and inspect the file selection of Dockerfile `production` stage.

    The Dockerfile specifies:
      COPY package.json package-lock.json ./
      RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
      COPY --from=build /app/dist ./dist

    Note on scope: This tests the file-selection boundary (dist + package manifests)
    and executes runtime licensing verification. It does not invoke the Docker daemon
    or execute a separate npm ci inside the sandbox.
    """
    errors: list[str] = []
    dist_dir = backend_dir / "dist"
    pkg_path = backend_dir / "package.json"
    lock_path = backend_dir / "package-lock.json"

    if not dist_dir.is_dir():
        return [f"Cannot assemble production stage deliverable: dist missing at {dist_dir}"]
    if not pkg_path.is_file() or not lock_path.is_file():
        return [f"Cannot assemble production stage deliverable: package manifests missing"]

    with tempfile.TemporaryDirectory() as stage_dir_str:
        stage_dir = Path(stage_dir_str)
        stage_dist = stage_dir / "dist"
        shutil.copytree(dist_dir, stage_dist)
        shutil.copy(pkg_path, stage_dir / "package.json")
        shutil.copy(lock_path, stage_dir / "package-lock.json")

        backend_node_modules = backend_dir / "node_modules"
        if backend_node_modules.is_dir():
            os.symlink(backend_node_modules, stage_dir / "node_modules")

        # 1. Inspect the simulated container filesystem
        dist_errors = inspect_dist(stage_dist)
        for err in dist_errors:
            errors.append(f"[Docker production stage deliverable] {err}")

        # 2. Inspect package.json in the deliverable
        pkg_errors = inspect_package_scripts(stage_dir / "package.json")
        for err in pkg_errors:
            errors.append(f"[Docker production stage deliverable] {err}")

        # 3. Execute customer license verification in the deliverable environment
        lic_errors = execute_customer_license_verification(stage_dir)
        for err in lic_errors:
            errors.append(f"[Docker production stage deliverable] {err}")

    return errors


def scan_key_hygiene(repo_root: Path) -> list[str]:
    errors: list[str] = []
    cmd = ["git", "ls-files"]
    proc = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        return [f"git ls-files failed: {proc.stderr}"]

    files_to_check = set(line.strip() for line in proc.stdout.splitlines() if line.strip())

    staged_proc = subprocess.run(
        ["git", "diff", "--name-only", "--cached"],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        check=False,
    )
    if staged_proc.returncode == 0:
        files_to_check.update(line.strip() for line in staged_proc.stdout.splitlines() if line.strip())

    forbidden_exts = {".key", ".pem", ".p8", ".pkcs8"}
    for f in files_to_check:
        p = Path(f)
        if p.suffix.lower() in forbidden_exts:
            errors.append(f"Tracked/staged file has forbidden private-key extension: {f}")

        # Exclude documentation files and explicitly bounded scanner script locations
        if f.endswith((".md", ".txt")) or f.startswith("docs/") or f in EXCLUDED_FROM_PEM_SCAN:
            continue

        full_path = repo_root / f
        try:
            content = full_path.read_text(encoding="utf-8", errors="ignore")
            if PEM_KEY_PATTERN.search(content):
                errors.append(f"Tracked/staged file contains PEM private key pattern: {f}")
        except OSError:
            pass

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

    print("\n=== [3/4] Verifying Docker production stage deliverable parity & licensing runtime ===")
    stage_errors = verify_docker_production_stage_parity(backend_dir)
    if stage_errors:
        for err in stage_errors:
            print(f"  [ERROR] {err}")
        all_errors.extend(stage_errors)
    else:
        print("  [PASS] Production stage deliverable is free of issuer and passes real license verification.")

    print("\n=== [4/4] Scanning repository for private-key material and hygiene ===")
    key_errors = scan_key_hygiene(repo_root)
    if key_errors:
        for err in key_errors:
            print(f"  [ERROR] {err}")
        all_errors.extend(key_errors)
    else:
        print("  [PASS] No private key material found in tracked or staged files.")

    if all_errors:
        print(f"\nFAILED: {len(all_errors)} defect(s) detected.")
        return 1

    print("\nSUCCESS: All production artifact, Docker parity, and key hygiene gates passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
