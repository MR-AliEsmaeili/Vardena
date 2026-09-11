import { describe, expect, it } from 'vitest';
import { isValidPermissionCode } from '../../rbac/domain/permission-code.js';
import { INVENTORY_CORE_PERMISSION_DEFINITIONS } from './inventory-core-permissions.js';

/**
 * The Task 7 permission vocabulary: ten codes, one per implemented
 * capability. Same rules as the master-data vocabulary (no wildcards, no
 * Delete — ledger facts are never deleted), plus two core-specific locks:
 * reversal is its own code (not folded into Create), and the maintenance
 * rebuild is its own code (not folded into the read-only report).
 */
describe('inventory core permission vocabulary', () => {
  it('contains exactly the ten implemented codes', () => {
    expect(
      INVENTORY_CORE_PERMISSION_DEFINITIONS.map(({ code }) => code).sort(),
    ).toEqual(
      [
        'Inventory.Balance.View',
        'Inventory.Movement.Create',
        'Inventory.Movement.Reverse',
        'Inventory.Movement.View',
        'Inventory.Reconciliation.Execute',
        'Inventory.Reconciliation.View',
        'Inventory.Reservation.Create',
        'Inventory.Reservation.Release',
        'Inventory.Reservation.View',
        'Inventory.Transfer.Create',
      ].sort(),
    );
  });

  it.each(
    INVENTORY_CORE_PERMISSION_DEFINITIONS.map(
      (definition) => [definition.code, definition] as const,
    ),
  )('%s is a well-formed permission code', (code, definition) => {
    expect(isValidPermissionCode(code)).toBe(true);
    expect(definition.description.trim().length).toBeGreaterThan(0);
  });

  it('contains no wildcard, SuperAdmin grant, or Delete action', () => {
    for (const { code } of INVENTORY_CORE_PERMISSION_DEFINITIONS) {
      expect(code, code).not.toContain('*');
      expect(code.toLowerCase(), code).not.toContain('superadmin');
      expect(code.toLowerCase(), code).not.toContain('all');
      expect(code.split('.')[2], code).not.toBe('Delete');
    }
  });

  it('keeps reversal separate from creation', () => {
    const actions = INVENTORY_CORE_PERMISSION_DEFINITIONS.map(
      ({ code }) => code,
    ).filter((code) => code.startsWith('Inventory.Movement.'));
    expect(actions.sort()).toEqual(
      [
        'Inventory.Movement.Create',
        'Inventory.Movement.Reverse',
        'Inventory.Movement.View',
      ].sort(),
    );
  });

  it('keeps the rebuild separate from the read-only report', () => {
    const actions = INVENTORY_CORE_PERMISSION_DEFINITIONS.map(
      ({ code }) => code,
    ).filter((code) => code.startsWith('Inventory.Reconciliation.'));
    expect(actions.sort()).toEqual(
      [
        'Inventory.Reconciliation.Execute',
        'Inventory.Reconciliation.View',
      ].sort(),
    );
  });
});
