import { describe, expect, it } from 'vitest';
import { PermissionRegistry } from './permission-registry.js';

describe('PermissionRegistry', () => {
  const definition = (code: string, description = 'A description.') => ({
    code,
    description,
  });

  it('registers definitions and lists them ordered by code', () => {
    const registry = new PermissionRegistry();
    registry.register([
      definition('Users.User.View'),
      definition('Rbac.Role.View'),
    ]);

    expect(registry.size).toBe(2);
    expect(registry.all().map((entry) => entry.code)).toEqual([
      'Rbac.Role.View',
      'Users.User.View',
    ]);
    expect(registry.has('Users.User.View')).toBe(true);
    expect(registry.has('Users.User.Delete')).toBe(false);
  });

  it('rejects a malformed code (programmer error, fail fast)', () => {
    const registry = new PermissionRegistry();
    expect(() => registry.register([definition('user.view')])).toThrow(
      /Invalid permission code/,
    );
    expect(registry.size).toBe(0);
  });

  it('rejects a definition without a description', () => {
    const registry = new PermissionRegistry();
    expect(() =>
      registry.register([definition('Users.User.View', '  ')]),
    ).toThrow(/must have a description/);
  });

  it('rejects registering the same code twice, even across modules', () => {
    const registry = new PermissionRegistry();
    registry.register([definition('Users.User.View')]);
    expect(() => registry.register([definition('Users.User.View')])).toThrow(
      /already registered/,
    );
  });

  it('rejects duplicates inside a single registration', () => {
    const registry = new PermissionRegistry();
    expect(() =>
      registry.register([
        definition('Users.User.View'),
        definition('Users.User.View'),
      ]),
    ).toThrow(/Duplicate permission code/);
  });
});
