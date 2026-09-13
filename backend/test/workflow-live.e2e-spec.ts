import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { AppException } from '../src/kernel/errors/app-exception.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { WorkflowDefinitionsService } from '../src/modules/workflow/application/workflow-definitions.service.js';
import { WorkflowVersionsService } from '../src/modules/workflow/application/workflow-versions.service.js';
import { WorkflowStatesService } from '../src/modules/workflow/application/workflow-states.service.js';
import { WorkflowTransitionsService } from '../src/modules/workflow/application/workflow-transitions.service.js';
import { WorkflowInstancesService } from '../src/modules/workflow/application/workflow-instances.service.js';
import { WorkflowApprovalsService } from '../src/modules/workflow/application/workflow-approvals.service.js';
import { WORKFLOW_INSTANCE_PERMISSIONS } from '../src/modules/workflow/domain/workflow-permissions.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database concurrency suite for the Workflow Foundation (Task 9 §17).
 * Skipped unless VARDENA_TEST_DATABASE_URL is set (CI with Postgres, or
 * local Docker). Requires a generated client (`npm run prisma:generate`)
 * and a migrated database (`prisma migrate dev`).
 *
 * This is where the `SELECT … FOR UPDATE` locks and the unique indexes are
 * exercised for real: concurrent A→B vs A→C transitions must serialize with
 * exactly one winner, concurrent publishes of one draft must not double-
 * activate, and approval staleness must hold under the real transaction.
 * The in-memory suite (`workflow.e2e-spec.ts`) covers the same contracts
 * with faked data access; service-level calls here run in system context,
 * so RBAC enforcement is NOT in scope (covered by the HTTP suite).
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Workflow Foundation (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizationId = '';
    let otherOrganizationId = '';
    let definitionId = '';
    let versionId = '';
    let stateA = '';
    let stateB = '';
    let stateC = '';
    let transitionAB = '';
    let transitionAC = '';

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      const organizations = app.get(OrganizationsService);
      const definitions = app.get(WorkflowDefinitionsService);
      const versions = app.get(WorkflowVersionsService);
      const states = app.get(WorkflowStatesService);
      const transitions = app.get(WorkflowTransitionsService);

      organizationId = (
        await organizations.createOrganization({
          code: `WF-${suffix}`,
          name: 'Workflow live org',
        })
      ).id;
      otherOrganizationId = (
        await organizations.createOrganization({
          code: `WFX-${suffix}`,
          name: 'Workflow live other org',
        })
      ).id;

      definitionId = (
        await definitions.createDefinition({
          organizationId,
          code: `race_flow_${suffix}`,
          name: 'Race flow',
        })
      ).id;
      versionId = (
        await versions.createVersion({ organizationId, definitionId })
      ).id;
      stateA = (
        await states.createState({
          organizationId,
          versionId,
          code: 'state_a',
          name: 'State A',
          isInitial: true,
        })
      ).id;
      stateB = (
        await states.createState({
          organizationId,
          versionId,
          code: 'state_b',
          name: 'State B',
          isTerminal: true,
        })
      ).id;
      stateC = (
        await states.createState({
          organizationId,
          versionId,
          code: 'state_c',
          name: 'State C',
          isTerminal: true,
        })
      ).id;
      transitionAB = (
        await transitions.createTransition({
          organizationId,
          versionId,
          code: 'go_b',
          name: 'Go B',
          sourceStateId: stateA,
          targetStateId: stateB,
          requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
        })
      ).id;
      transitionAC = (
        await transitions.createTransition({
          organizationId,
          versionId,
          code: 'go_c',
          name: 'Go C',
          sourceStateId: stateA,
          targetStateId: stateC,
          requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
        })
      ).id;
      await versions.publishVersion(organizationId, versionId);
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) {
        // Test-only cleanup through the raw client; the API has no delete
        // endpoints for definitions, versions or instances (Task 9 §20).
        const client = await prisma.getClient<{
          workflowTransitionHistory: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          workflowApproval: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          workflowAutomationBinding: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          workflowInstance: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          workflowTransition: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          workflowState: { deleteMany: (args: unknown) => Promise<unknown> };
          workflowVersion: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          workflowDefinition: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        for (const orgId of [organizationId, otherOrganizationId]) {
          await client.workflowTransitionHistory.deleteMany({
            where: { organizationId: orgId },
          });
          await client.workflowApproval.deleteMany({
            where: { organizationId: orgId },
          });
          await client.workflowAutomationBinding.deleteMany({
            where: { organizationId: orgId },
          });
          await client.workflowInstance.deleteMany({
            where: { organizationId: orgId },
          });
          await client.workflowTransition.deleteMany({
            where: { organizationId: orgId },
          });
          await client.workflowState.deleteMany({
            where: { organizationId: orgId },
          });
          await client.workflowVersion.deleteMany({
            where: { organizationId: orgId },
          });
          await client.workflowDefinition.deleteMany({
            where: { organizationId: orgId },
          });
          await client.organization.deleteMany({ where: { id: orgId } });
        }
        await app.close();
      }
    }, 60_000);

    it('serializes concurrent A→B vs A→C transitions: one winner', async () => {
      const instances = app!.get(WorkflowInstancesService);
      const bound = await instances.bindInstance({
        organizationId,
        definitionId,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      });

      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, (_, index) =>
          instances.executeTransition({
            organizationId,
            instanceId: bound.id,
            transitionId: index % 2 === 0 ? transitionAB : transitionAC,
          }),
        ),
      );
      const fulfilled = attempts.filter(
        (attempt) => attempt.status === 'fulfilled',
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === 'rejected',
      );
      // The hard guarantee: the row lock serializes the race — exactly one
      // winner, every loser a 409 with no partial write.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(19);
      for (const loser of rejected) {
        expect(loser.reason).toBeInstanceOf(AppException);
        expect((loser.reason as AppException).code).toBe('Conflict');
      }

      const history = await instances.listHistory({
        organizationId,
        instanceId: bound.id,
        page: 1,
        pageSize: 10,
      });
      expect(history.total).toBe(1);
      expect(history.items[0]?.sequence).toBe(1);

      const instance = await instances.getInstance(organizationId, bound.id);
      expect([stateB, stateC]).toContain(instance.currentStateId);
    });

    it('rejects a concurrent second publish of the same draft', async () => {
      const definitions = app!.get(WorkflowDefinitionsService);
      const versions = app!.get(WorkflowVersionsService);
      const states = app!.get(WorkflowStatesService);
      const definition = await definitions.createDefinition({
        organizationId,
        code: `publish_race_${suffix}`,
        name: 'Publish race',
      });
      const version = await versions.createVersion({
        organizationId,
        definitionId: definition.id,
      });
      await states.createState({
        organizationId,
        versionId: version.id,
        code: 'only',
        name: 'Only',
        isInitial: true,
        isTerminal: true,
      });

      const attempts = await Promise.allSettled([
        versions.publishVersion(organizationId, version.id),
        versions.publishVersion(organizationId, version.id),
      ]);
      const fulfilled = attempts.filter(
        (attempt) => attempt.status === 'fulfilled',
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        AppException,
      );
      // Both publishers pass the 422 pre-check as drafts; the loser fails the
      // draft re-check inside the serialized transaction, so it surfaces as
      // 409 Conflict ("re-read before retrying") — ADR-0024 §3: lost races →
      // 409, same as the transition race above. A SEQUENTIAL republish stays
      // 422 (workflow.e2e-spec.ts 'freezes its configuration').
      expect(
        ((rejected[0] as PromiseRejectedResult).reason as AppException).code,
      ).toBe('Conflict');

      const published = await versions.getVersion(organizationId, version.id);
      expect(published.status).toBe('active');
    });

    it('holds approval staleness under the real transaction', async () => {
      const definitions = app!.get(WorkflowDefinitionsService);
      const versions = app!.get(WorkflowVersionsService);
      const states = app!.get(WorkflowStatesService);
      const transitions = app!.get(WorkflowTransitionsService);
      const instances = app!.get(WorkflowInstancesService);
      const approvals = app!.get(WorkflowApprovalsService);

      const definition = await definitions.createDefinition({
        organizationId,
        code: `approval_race_${suffix}`,
        name: 'Approval race',
      });
      const version = await versions.createVersion({
        organizationId,
        definitionId: definition.id,
      });
      const pending = await states.createState({
        organizationId,
        versionId: version.id,
        code: 'pending',
        name: 'Pending',
        isInitial: true,
      });
      const done = await states.createState({
        organizationId,
        versionId: version.id,
        code: 'done',
        name: 'Done',
        isTerminal: true,
      });
      const gated = await transitions.createTransition({
        organizationId,
        versionId: version.id,
        code: 'gated',
        name: 'Gated',
        sourceStateId: pending.id,
        targetStateId: done.id,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
        requiresApproval: true,
      });
      const direct = await transitions.createTransition({
        organizationId,
        versionId: version.id,
        code: 'direct',
        name: 'Direct',
        sourceStateId: pending.id,
        targetStateId: done.id,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      });
      await versions.publishVersion(organizationId, version.id);

      const bound = await instances.bindInstance({
        organizationId,
        definitionId: definition.id,
        entityModule: 'accounting',
        entityType: 'payment_order',
        entityId: generateId(),
      });
      const requested = await approvals.requestApproval({
        organizationId,
        instanceId: bound.id,
        transitionId: gated.id,
      });
      await instances.executeTransition({
        organizationId,
        instanceId: bound.id,
        transitionId: direct.id,
      });

      await expect(
        approvals.decideApproval({
          organizationId,
          approvalId: requested.id,
          decision: 'approved',
        }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
    });

    it('isolates workflow rows by organization at the database level', async () => {
      const instances = app!.get(WorkflowInstancesService);
      const bound = await instances.bindInstance({
        organizationId,
        definitionId,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      });

      await expect(
        instances.getInstance(otherOrganizationId, bound.id),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        instances.executeTransition({
          organizationId: otherOrganizationId,
          instanceId: bound.id,
          transitionId: transitionAB,
        }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });
  },
);
