import { describe, expect, it } from 'vitest';
import { INVENTORY_PERMISSION_DEFINITIONS } from './inventory/domain/inventory-permissions.js';
import { ORGANIZATION_PERMISSION_DEFINITIONS } from './organization/domain/organization-permissions.js';
import { isValidPermissionCode } from './rbac/domain/permission-code.js';

/**
 * The Task 6 permission vocabulary.
 *
 * Two things are worth locking down in a test, because both fail only at
 * startup or, worse, only in production:
 *
 * 1. Every code must satisfy the registry's `Module.Entity.Action` shape. The
 *    registry rejects anything else, so a typo here breaks boot rather than
 *    one endpoint — and a 2-segment code (e.g. `Organization.View`) is exactly
 *    the mistake an abbreviated brief invites.
 * 2. No wildcard and no `Delete`. AR-22 forbids `*`/SuperAdmin-style grants,
 *    and Task 6 implements no deletion (lifecycle is `is_active`, OQ-36), so a
 *    `*.Delete` code here would advertise an operation that does not exist.
 */

const ALL = [
  ...ORGANIZATION_PERMISSION_DEFINITIONS,
  ...INVENTORY_PERMISSION_DEFINITIONS,
];

describe('master-data permission vocabulary', () => {
  it('contains the 25 Organization codes', () => {
    expect(ORGANIZATION_PERMISSION_DEFINITIONS).toHaveLength(25);
  });

  it('contains the 22 Inventory codes', () => {
    // 4 lifecycle entities × 5 actions + UnitConversion's View/Create.
    expect(INVENTORY_PERMISSION_DEFINITIONS).toHaveLength(22);
  });

  it('has no duplicate codes', () => {
    const codes = ALL.map((definition) => definition.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(ALL.map((definition) => [definition.code, definition] as const))(
    '%s is a well-formed permission code',
    (code, definition) => {
      expect(isValidPermissionCode(code)).toBe(true);
      expect(definition.description.trim().length).toBeGreaterThan(0);
    },
  );

  it('uses exactly three dot-separated PascalCase segments', () => {
    for (const { code } of ALL) {
      const segments = code.split('.');
      expect(segments, code).toHaveLength(3);
      for (const segment of segments) {
        expect(segment, code).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      }
    }
  });

  it('contains no wildcard or SuperAdmin grant', () => {
    for (const { code } of ALL) {
      expect(code, code).not.toContain('*');
      expect(code.toLowerCase(), code).not.toContain('superadmin');
      expect(code.toLowerCase(), code).not.toContain('all');
    }
  });

  it('contains no Delete action: Task 6 has no deletion', () => {
    const actions = ALL.map(({ code }) => code.split('.')[2]);
    expect(new Set(actions)).toEqual(
      new Set(['View', 'Create', 'Edit', 'Enable', 'Disable']),
    );
  });

  it('gives UnitConversion only View and Create (no in-place edit)', () => {
    // ADR-0020 §4: effective-dated configuration is never edited in place.
    const conversionCodes = INVENTORY_PERMISSION_DEFINITIONS.map(
      ({ code }) => code,
    ).filter((code) => code.startsWith('Inventory.UnitConversion.'));
    expect(conversionCodes.sort()).toEqual([
      'Inventory.UnitConversion.Create',
      'Inventory.UnitConversion.View',
    ]);
  });

  it('gives every lifecycle entity the same five actions', () => {
    const entities = [
      'Organization.Organization',
      'Organization.Branch',
      'Organization.Department',
      'Organization.Employee',
      'Organization.Party',
      'Inventory.Item',
      'Inventory.ItemGroup',
      'Inventory.Unit',
      'Inventory.Warehouse',
    ];
    const codes = ALL.map(({ code }) => code);
    for (const entity of entities) {
      const actions = codes
        .filter((code) => code.startsWith(`${entity}.`))
        .map((code) => code.split('.')[2])
        .sort();
      expect(actions, entity).toEqual([
        'Create',
        'Disable',
        'Edit',
        'Enable',
        'View',
      ]);
    }
  });
});
