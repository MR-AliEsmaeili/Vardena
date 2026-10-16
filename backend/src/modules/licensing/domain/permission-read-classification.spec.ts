import { describe, expect, it } from 'vitest';
import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { ACCOUNTING_PERMISSION_DEFINITIONS } from '../../accounting/domain/accounting-permissions.js';
import { DOCUMENT_PERMISSION_DEFINITIONS } from '../../documents/domain/document-permissions.js';
import { INVENTORY_CORE_PERMISSION_DEFINITIONS } from '../../inventory/domain/inventory-core-permissions.js';
import { INVENTORY_DOCUMENT_PERMISSION_DEFINITIONS } from '../../inventory/domain/inventory-document-permissions.js';
import { INVENTORY_PERMISSION_DEFINITIONS } from '../../inventory/domain/inventory-permissions.js';
import { INVENTORY_VALUATION_PERMISSION_DEFINITIONS } from '../../inventory/domain/inventory-valuation-permissions.js';
import { MATERIAL_REQUEST_PERMISSION_DEFINITIONS } from '../../inventory/domain/material-request-permissions.js';
import { ORGANIZATION_PERMISSION_DEFINITIONS } from '../../organization/domain/organization-permissions.js';
import { RBAC_PERMISSION_DEFINITIONS } from '../../rbac/domain/rbac-permissions.js';
import { USER_PERMISSION_DEFINITIONS } from '../../users/domain/user-permissions.js';
import { WORKFLOW_PERMISSION_DEFINITIONS } from '../../workflow/domain/workflow-permissions.js';
import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';
import {
  isPlatformPermission,
  isReadPermissionCode,
  permissionModuleCode,
} from './license.js';
import { LICENSING_PERMISSION_DEFINITIONS } from './licensing-permissions.js';
import { KNOWN_MODULE_CODES } from './license-code.js';

/**
 * OQ-45 / ADR-0049 §3 Read-Only classification, checked against the REAL
 * permission catalog.
 *
 * Read-Only keeps a permission only when its final code segment is `View` or
 * `Export`. That rule is only safe while it is true of every registered code:
 * a future read capability named `Print`, `Download` or `Preview` would be
 * silently blocked in Read-Only, and a permission whose module has no signed
 * entitlement code could never be effective in any mode. Both are catalog
 * facts, not per-file facts, so they are pinned here once — on the same
 * definition arrays every module registers at startup.
 *
 * Adding a permission is therefore a deliberate act: `View`/`Export` are reads
 * and nothing else is. Anything else must be justified here, next to the
 * decision it changes.
 */
const ALL_DEFINITIONS: readonly PermissionDefinition[] = [
  ...ACCOUNTING_PERMISSION_DEFINITIONS,
  ...DOCUMENT_PERMISSION_DEFINITIONS,
  ...INVENTORY_PERMISSION_DEFINITIONS,
  ...INVENTORY_CORE_PERMISSION_DEFINITIONS,
  ...INVENTORY_DOCUMENT_PERMISSION_DEFINITIONS,
  ...INVENTORY_VALUATION_PERMISSION_DEFINITIONS,
  ...LICENSING_PERMISSION_DEFINITIONS,
  ...MATERIAL_REQUEST_PERMISSION_DEFINITIONS,
  ...ORGANIZATION_PERMISSION_DEFINITIONS,
  ...RBAC_PERMISSION_DEFINITIONS,
  ...USER_PERMISSION_DEFINITIONS,
  ...WORKFLOW_PERMISSION_DEFINITIONS,
];

const ALL_CODES: readonly string[] = ALL_DEFINITIONS.map(({ code }) => code);

/** Verbs that read, without deciding anything: the guard below uses them. */
const READ_VERBS = [
  'View',
  'Export',
  'Print',
  'Download',
  'Preview',
  'Read',
  'List',
  'Get',
  'Fetch',
  'Lookup',
  'Inspect',
  'Query',
  'Search',
  'Show',
  'Display',
  'Report',
] as const;

/** The Read-Only read rule, restated independently of `isReadPermissionCode`. */
function isReadByRule(code: string): boolean {
  const segment = code.split('.').at(-1);
  return segment === 'View' || segment === 'Export';
}

describe('OQ-45 Read-Only read classification over the registered catalog', () => {
  it('covers the whole catalog exactly once', () => {
    // Sanity: the union really is the whole registered vocabulary (a missing
    // import would make every check below vacuous) and no code is registered
    // twice by two modules.
    expect(ALL_CODES.length).toBeGreaterThan(80);
    expect(new Set(ALL_CODES).size).toBe(ALL_CODES.length);
  });

  it('has no registered read-verb code that Read-Only would treat as a mutation', () => {
    const misclassified = ALL_CODES.filter((code) => {
      const segment = code.split('.').at(-1) ?? '';
      return (
        (READ_VERBS as readonly string[]).includes(segment) &&
        !isReadByRule(code)
      );
    });
    // `Print` is not a registered permission anywhere: printing is authorized
    // by the document's own `View`/`Export` code, so Read-Only does not block
    // it. If that ever changes, this test is where the classification decision
    // has to be made explicitly.
    expect(misclassified).toEqual([]);
    expect(ALL_CODES).not.toContain('Accounting.Document.Print');
  });

  it('maps every registered code to a module the signed license can entitle', () => {
    const known = new Set<string>([...KNOWN_MODULE_CODES, 'licensing']);
    const unknown = ALL_CODES.filter(
      (code) => !known.has(permissionModuleCode(code)),
    );
    expect(unknown).toEqual([]);
  });

  it('agrees with isReadPermissionCode on every registered code', () => {
    for (const code of ALL_CODES) {
      expect({ code, read: isReadPermissionCode(code) }).toEqual({
        code,
        read: isReadByRule(code),
      });
    }
  });

  it('keeps exactly the reads and the platform codes effective in Read-Only', async () => {
    const modules = [
      ...new Set(ALL_CODES.map((code) => permissionModuleCode(code))),
    ];
    const licensing = licensingTestDouble({
      // Far past the signed expiry and beyond 14x24h: READ_ONLY.
      validUntil: new Date('2020-02-01T00:00:00.000Z'),
      entitlements: modules.map((code) => ({ kind: 'MODULE' as const, code })),
    });

    const effective = await licensing.filterLicensedPermissions(ALL_CODES);
    const expected = ALL_CODES.filter(
      (code) => isReadByRule(code) || isPlatformPermission(code),
    );

    // A session holding EVERY registered permission still cannot mutate in
    // Read-Only, and gains no code the license does not entitle.
    expect([...effective].sort()).toEqual([...expected].sort());
  });
});
