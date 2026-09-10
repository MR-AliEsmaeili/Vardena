import { describe, expect, it } from 'vitest';
import {
  isValidPermissionCode,
  MAX_PERMISSION_CODE_LENGTH,
} from './permission-code.js';

describe('permission codes (AR-22)', () => {
  it('accepts Module.Entity.Action codes', () => {
    for (const code of [
      'Users.User.View',
      'Users.User.ResetPassword',
      'Rbac.RolePermission.Assign',
      'Inventory.Receipt.Create',
      'Accounting.JournalEntry.Post',
    ]) {
      expect(isValidPermissionCode(code)).toBe(true);
    }
  });

  it('rejects wildcards, wrong segment counts, lower case and empty parts', () => {
    for (const code of [
      '*',
      'Users.*',
      'Users.User.*',
      'users.User.View',
      'Users.user.View',
      'Users.User.view',
      'Users.User',
      'Users.User.View.Extra',
      'Users..View',
      '.User.View',
      'Users.User.',
      ' ',
    ]) {
      expect(isValidPermissionCode(code)).toBe(false);
    }
  });

  it('rejects codes longer than the stored column', () => {
    const long = `Users.User.${'A'.repeat(MAX_PERMISSION_CODE_LENGTH)}`;
    expect(long.length).toBeGreaterThan(MAX_PERMISSION_CODE_LENGTH);
    expect(isValidPermissionCode(long)).toBe(false);
  });

  it('accepts a code exactly at the length limit', () => {
    const prefix = 'Users.User.';
    const code =
      prefix + 'A'.repeat(MAX_PERMISSION_CODE_LENGTH - prefix.length);
    expect(code.length).toBe(MAX_PERMISSION_CODE_LENGTH);
    expect(isValidPermissionCode(code)).toBe(true);
  });
});
