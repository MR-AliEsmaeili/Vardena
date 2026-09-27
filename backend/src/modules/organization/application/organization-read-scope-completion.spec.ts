import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Surface {
  module: string;
  service: string;
  method: string;
  organizationId: 'query.organizationId' | 'organizationId';
}

const surfaces: Surface[] = [
  {
    module: 'accounting',
    service: 'accounting-configurations',
    method: 'listConfigurations',
    organizationId: 'query.organizationId',
  },
  {
    module: 'accounting',
    service: 'accounting-periods',
    method: 'listAccountingPeriods',
    organizationId: 'query.organizationId',
  },
  {
    module: 'accounting',
    service: 'coding-structures',
    method: 'listVersions',
    organizationId: 'query.organizationId',
  },
  {
    module: 'accounting',
    service: 'financial-areas',
    method: 'listFinancialAreas',
    organizationId: 'query.organizationId',
  },
  {
    module: 'accounting',
    service: 'fiscal-years',
    method: 'listFiscalYears',
    organizationId: 'query.organizationId',
  },
  {
    module: 'documents',
    service: 'document-relations',
    method: 'listRelations',
    organizationId: 'query.organizationId',
  },
  {
    module: 'documents',
    service: 'document-relations',
    method: 'getRelation',
    organizationId: 'organizationId',
  },
  {
    module: 'documents',
    service: 'numbering',
    method: 'listAllocations',
    organizationId: 'query.organizationId',
  },
  {
    module: 'documents',
    service: 'numbering',
    method: 'getAllocation',
    organizationId: 'organizationId',
  },
  {
    module: 'documents',
    service: 'numbering-series',
    method: 'getNumberingSeries',
    organizationId: 'organizationId',
  },
  {
    module: 'inventory',
    service: 'inventory-balances',
    method: 'listBalances',
    organizationId: 'query.organizationId',
  },
  {
    module: 'inventory',
    service: 'inventory-movements',
    method: 'listMovements',
    organizationId: 'query.organizationId',
  },
  {
    module: 'inventory',
    service: 'inventory-reservations',
    method: 'listReservations',
    organizationId: 'query.organizationId',
  },
  {
    module: 'inventory',
    service: 'item-groups',
    method: 'listItemGroups',
    organizationId: 'query.organizationId',
  },
  {
    module: 'inventory',
    service: 'items',
    method: 'listItems',
    organizationId: 'query.organizationId',
  },
  {
    module: 'inventory',
    service: 'unit-conversions',
    method: 'listConversions',
    organizationId: 'query.organizationId',
  },
  {
    module: 'inventory',
    service: 'units',
    method: 'listUnits',
    organizationId: 'query.organizationId',
  },
  {
    module: 'inventory',
    service: 'warehouses',
    method: 'listWarehouses',
    organizationId: 'query.organizationId',
  },
  {
    module: 'organization',
    service: 'branches',
    method: 'listBranches',
    organizationId: 'query.organizationId',
  },
  {
    module: 'organization',
    service: 'departments',
    method: 'listDepartments',
    organizationId: 'query.organizationId',
  },
  {
    module: 'organization',
    service: 'employees',
    method: 'listEmployees',
    organizationId: 'query.organizationId',
  },
  {
    module: 'organization',
    service: 'parties',
    method: 'listParties',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-approvals',
    method: 'listApprovals',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-automations',
    method: 'listAutomations',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-automations',
    method: 'getAutomation',
    organizationId: 'organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-definitions',
    method: 'listDefinitions',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-definitions',
    method: 'getDefinition',
    organizationId: 'organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-instances',
    method: 'listInstances',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-instances',
    method: 'getInstance',
    organizationId: 'organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-instances',
    method: 'listAvailableTransitions',
    organizationId: 'organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-instances',
    method: 'listHistory',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-states',
    method: 'listStates',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-states',
    method: 'getState',
    organizationId: 'organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-transitions',
    method: 'listTransitions',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-transitions',
    method: 'getTransition',
    organizationId: 'organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-versions',
    method: 'listVersions',
    organizationId: 'query.organizationId',
  },
  {
    module: 'workflow',
    service: 'workflow-versions',
    method: 'getVersion',
    organizationId: 'organizationId',
  },
];

function methodBody(source: string, method: string): string {
  const signature = source.indexOf(`async ${method}`);
  expect(signature, `${method} must exist`).toBeGreaterThanOrEqual(0);
  const openingBrace = source.indexOf('{', signature);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  throw new Error(`Could not find the end of ${method}`);
}

describe('Task 26 ODR-3 organization read-scope completion', () => {
  it('pins the independently re-audited inventory at exactly 37 surfaces', () => {
    expect(surfaces).toHaveLength(37);
  });

  it.each(surfaces)(
    '$module/$service::$method keeps permission first and explicitly asserts its caller-supplied organization before the read',
    ({ module, service, method, organizationId }) => {
      const source = readFileSync(
        resolve(
          'src',
          'modules',
          module,
          'application',
          `${service}.service.ts`,
        ),
        'utf8',
      );
      const body = methodBody(source, method);
      const permission = body.indexOf(
        'await this.authorization.requireAllPermissions',
      );
      const scopeCall = `await this.organizations.assertOrganizationInScope(${organizationId});`;
      const scope = body.indexOf(scopeCall);

      expect(
        permission,
        'permission enforcement must remain present',
      ).toBeGreaterThanOrEqual(0);
      expect(
        scope,
        `missing explicit scope call: ${scopeCall}`,
      ).toBeGreaterThan(permission);
      expect(
        body.indexOf(scopeCall, scope + 1),
        'scope call must be unambiguous',
      ).toBe(-1);
    },
  );
});
