import { describe, expect, it } from 'vitest';
import { isValidPermissionCode } from '../../rbac/domain/permission-code.js';
import { WORKFLOW_PERMISSION_DEFINITIONS } from './workflow-permissions.js';

/**
 * The Workflow permission vocabulary (Task 9 §9).
 *
 * Ten codes covering definitions, versions (including draft configuration)
 * and runtime — every one well-formed `Module.Entity.Action`, no wildcard,
 * no superuser, and (critically) no "bypass workflow rules" grant. There is
 * no legal way around a valid transition check, and no code may invent one.
 */
describe('workflow permission vocabulary', () => {
  it('contains the 10 workflow codes', () => {
    expect(
      WORKFLOW_PERMISSION_DEFINITIONS.map(({ code }) => code).sort(),
    ).toEqual([
      'Workflow.Definition.Create',
      'Workflow.Definition.Edit',
      'Workflow.Definition.View',
      'Workflow.Instance.Bind',
      'Workflow.Instance.Execute',
      'Workflow.Instance.View',
      'Workflow.Version.Create',
      'Workflow.Version.Edit',
      'Workflow.Version.Publish',
      'Workflow.Version.View',
    ]);
  });

  it('has no duplicate codes', () => {
    const codes = WORKFLOW_PERMISSION_DEFINITIONS.map(({ code }) => code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(
    WORKFLOW_PERMISSION_DEFINITIONS.map(
      (definition) => [definition.code, definition] as const,
    ),
  )('%s is a well-formed permission code', (code, definition) => {
    expect(isValidPermissionCode(code)).toBe(true);
    expect(definition.description.trim().length).toBeGreaterThan(0);
  });

  it('contains no wildcard, superuser or bypass grant', () => {
    for (const { code } of WORKFLOW_PERMISSION_DEFINITIONS) {
      expect(code, code).not.toContain('*');
      expect(code.toLowerCase(), code).not.toContain('superadmin');
      expect(code.toLowerCase(), code).not.toContain('all');
      expect(code.toLowerCase(), code).not.toContain('bypass');
    }
  });
});
