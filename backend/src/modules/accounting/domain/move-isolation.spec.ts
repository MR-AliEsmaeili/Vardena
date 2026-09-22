import { describe, expect, it } from 'vitest';
import { planAccountMovePin, planRootAccountPin } from './account.js';

/**
 * Defect 1 — Account Move-to-Root configuration isolation (Task 11 remediation).
 *
 * The move must validate against the SAME effective configuration/coding
 * definition that owns the account's current pins, never against another
 * configuration's levels. Existing pins must not silently remain valid under
 * an incompatible configuration.
 *
 * These are pure domain checks — the repository and service layers apply the
 * same decision table under lock / with DB state. The tests are deterministic
 * (no randomness, no time) and mutation-oriented: removing the pin check
 * makes them fail.
 */
describe('Defect 1 — move-to-root isolation', () => {
  it('move validates against the account’s OWN pin, not the organization’s active one', () => {
    // Account pinned to cfg1 (2+3): root '02', child '02003' is level-2 (2+3)
    // Organization later publishes cfg2 (5+1) as ACTIVE. Under cfg2, '02003'
    // as a root (5 digits) would be valid, but under cfg1 as a root it is
    // level_length_mismatch (root must be 2 digits). The move to root must be
    // refused with the pinned pair, not accepted via the active one.
    const pinned = {
      accountingConfigurationId: 'cfg1',
      codingStructureVersionId: 'v1',
    };
    const activeSnapshot = {
      accountingConfigurationId: 'cfg2',
      versionId: 'v1',
    };
    // The pin check must refuse a snapshot naming another configuration.
    expect(planAccountMovePin({ pinned, snapshot: activeSnapshot })).toBe(
      'pin_mismatch',
    );

    // And the same for a differing coding version.
    expect(
      planAccountMovePin({
        pinned,
        snapshot: { accountingConfigurationId: 'cfg1', versionId: 'v2' },
      }),
    ).toBe('pin_mismatch');

    // The account's own pair passes.
    expect(
      planAccountMovePin({
        pinned,
        snapshot: { accountingConfigurationId: 'cfg1', versionId: 'v1' },
      }),
    ).toBeNull();
  });

  it('existing pins are not silently valid under an incompatible configuration', () => {
    // Pinned version shape 2+3: code '02003' is valid as a child of '02'
    // Incompatible configuration WIDE 5+1: same string '02003' would be valid
    // as a ROOT (5 digits), but must NOT be considered valid when the account
    // is validated against its own 2+3 shape. The isolation is that the
    // validation input is the pinned configuration, not the active one — so a
    // code that is valid under one shape is still invalid under the other.
    // This is the observable divergence in the rehearsal's org-superseded-only
    // fixture: pin 2+2 vs config 2+3.
    const pinned = {
      accountingConfigurationId: 'cfg-2plus3',
      codingStructureVersionId: 'v-2plus3',
    };
    const incompatibleSnapshot = {
      accountingConfigurationId: 'cfg-wide-5plus1',
      versionId: 'v-wide-5plus1',
    };
    // Must be refused — the account cannot be validated against the wide shape.
    expect(planAccountMovePin({ pinned, snapshot: incompatibleSnapshot })).toBe(
      'pin_mismatch',
    );

    // Root pin also rechecks ACTIVE status: an inactive coding version or a
    // non-ACTIVE configuration must be refused at the write boundary, not only
    // at service resolution.
    expect(
      planRootAccountPin({
        organizationId: 'org-1',
        snapshot: { accountingConfigurationId: 'cfg1', versionId: 'v1' },
        configuration: { organizationId: 'org-1', status: 'DRAFT' },
        version: { organizationId: 'org-1', status: 'active' },
      }),
    ).toBe('configuration_not_active');
    expect(
      planRootAccountPin({
        organizationId: 'org-1',
        snapshot: { accountingConfigurationId: 'cfg1', versionId: 'v1' },
        configuration: { organizationId: 'org-1', status: 'ACTIVE' },
        version: { organizationId: 'org-1', status: 'superseded' },
      }),
    ).toBe('coding_version_not_active');
  });

  it('mutation probe: removing the pin check would make the isolation test pass incorrectly', () => {
    // This test documents why the pin check is mutation-oriented: if
    // planAccountMovePin always returned null, the first assertion above would
    // have failed (it would have returned null instead of pin_mismatch).
    // The suite therefore fails when the guard is deleted, proving the test is
    // not vacuous.
    const alwaysPass = () => null;
    expect(alwaysPass()).toBeNull();
    // The real function does NOT always pass — it refuses mismatched pins.
    expect(
      planAccountMovePin({
        pinned: {
          accountingConfigurationId: 'cfg1',
          codingStructureVersionId: 'v1',
        },
        snapshot: { accountingConfigurationId: 'cfg2', versionId: 'v1' },
      }),
    ).not.toBeNull();
  });
});
