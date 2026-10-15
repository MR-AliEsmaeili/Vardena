#!/usr/bin/env python3
"""Fail closed on Owner code/config in built customer artifacts or local dependencies.

The image argument is the real /app filesystem exported from the built customer
production image in CI. Existing signing-capability checks remain independent.
"""
import argparse
import json
import re
from pathlib import Path

MARKERS = [b'OWNER_DATABASE_URL', b'owner_session', b'owner.audit_events', b'vardena-owner-api', b'owner-licensing', 'سامانه مستقل مالک'.encode()]


def inspect_artifact(root):
    if not root.is_dir() or not any(root.rglob('*.js')):
        return [f'Customer artifact is absent or empty: {root}']
    errors = []
    for path in root.rglob('*'):
        if path.is_file():
            if path.is_symlink():
                errors.append(f'Symlink in customer artifact: {path}')
                continue
            data = path.read_bytes()
            if any(marker in data for marker in MARKERS) or 'owner-licensing' in str(path.relative_to(root)):
                errors.append(f'Owner code/config in customer artifact: {path}')
    return errors


def inspect_sources(repo):
    errors = []
    for workspace in ('backend', 'frontend'):
        package = json.loads((repo / workspace / 'package.json').read_text())
        if 'owner-licensing' in json.dumps(package) or any(str(v).startswith(('file:', 'link:', 'workspace:')) for section in ('dependencies', 'devDependencies') for v in package.get(section, {}).values()):
            errors.append(f'Customer {workspace} has a local/Owner dependency')
        source = repo / workspace / 'src'
        for path in source.rglob('*'):
            if path.suffix not in ('.ts', '.tsx', '.js') or '.spec.' in path.name or '.test.' in path.name:
                continue
            if path.is_symlink():
                errors.append(f'Symlink in customer source: {path}')
            content = path.read_text()
            if 'owner-licensing' in content or 'OWNER_DATABASE_URL' in content:
                errors.append(f'Customer source references Owner: {path}')
            for spec in re.findall(r'(?:from\s*|import\s*\(|require\s*\()\s*[\'\"]([^\'\"]+)', content):
                if spec.startswith('.') and not (path.parent / spec).resolve().is_relative_to((repo / workspace).resolve()):
                    errors.append(f'Import escapes customer workspace: {path}: {spec}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', default='.')
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--image-app')
    args = parser.parse_args()
    repo = Path(args.repo_root).resolve()
    errors = inspect_sources(repo) + inspect_artifact(Path(args.artifact))
    if args.image_app:
        image = Path(args.image_app)
        errors += inspect_artifact(image / 'dist')
        for name in ('package.json', 'package-lock.json'):
            path = image / name
            if not path.is_file() or any(m in path.read_bytes() for m in MARKERS):
                errors.append(f'Owner/absent production image manifest: {path}')
        if any('owner-licensing' in str(p.relative_to(image)) for p in image.rglob('*')):
            errors.append('Owner directory in customer production image')
    for error in errors:
        print(error)
    if not errors:
        print('Customer dependency graph and actual artifacts exclude Owner.')
    return int(bool(errors))


if __name__ == '__main__':
    raise SystemExit(main())
