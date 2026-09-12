import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import {
  DOMAIN_EVENT_BUS,
  type DomainEvent,
  type DomainEventBus,
} from '../src/kernel/events/domain-event-bus.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { WorkflowDefinitionsRepository } from '../src/modules/workflow/data/workflow-definitions.repository.js';
import { WorkflowVersionsRepository } from '../src/modules/workflow/data/workflow-versions.repository.js';
import { WorkflowStatesRepository } from '../src/modules/workflow/data/workflow-states.repository.js';
import { WorkflowTransitionsRepository } from '../src/modules/workflow/data/workflow-transitions.repository.js';
import { WorkflowInstancesRepository } from '../src/modules/workflow/data/workflow-instances.repository.js';
import { WorkflowHistoryRepository } from '../src/modules/workflow/data/workflow-history.repository.js';
import { WorkflowApprovalsRepository } from '../src/modules/workflow/data/workflow-approvals.repository.js';
import { WorkflowAutomationsRepository } from '../src/modules/workflow/data/workflow-automations.repository.js';
import { AutomationActionRegistry } from '../src/modules/workflow/application/automation-action-registry.js';
import {
  WORKFLOW_DEFINITION_PERMISSIONS,
  WORKFLOW_INSTANCE_PERMISSIONS,
  WORKFLOW_VERSION_PERMISSIONS,
} from '../src/modules/workflow/domain/workflow-permissions.js';
import {
  WORKFLOW_APPROVAL_DECIDED_EVENT,
  WORKFLOW_INSTANCE_BOUND_EVENT,
  WORKFLOW_TRANSITION_COMPLETED_EVENT,
  WORKFLOW_VERSION_PUBLISHED_EVENT,
} from '../src/modules/workflow/domain/workflow.events.js';
import {
  createInMemoryStores,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import {
  createMasterDataStores,
  type MasterDataStores,
} from './support/master-data-repositories.js';
import {
  createWorkflowStores,
  type WorkflowStores,
} from './support/workflow-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Workflow Foundation journeys (e2e, Task 9 §20).
 *
 * Boots the real application through the production HTTP pipeline
 * (`createTestApp` → `configureApp`): real controllers, real AuthGuard +
 * AuthorizationGuard, real application services, the real permission
 * registry and its startup mirror sync, the real domain event bus, real
 * DTO validation. Only data access is faked (in-memory repositories that
 * honour the real transaction contracts — see `support/workflow-repositories.ts`).
 *
 * The automation catalogue starts empty (Task 9 §18): the `notify` action
 * is registered here through the public registry, exactly like a future
 * owning module would at startup.
 *
 * API shape: collection POSTs (`definitions`, `instances`) carry
 * `organizationId` in the body; every route with path parameters takes it
 * as a query parameter. Fixture workflows (all in ACME unless noted):
 * - `goods_receipt` v1: received → inspected → posted, plus the direct and
 *   permission-gated branches the authorization tests need;
 * - `goods_receipt` v2: the superseding version bindings pin to afterwards;
 * - `payment_release` v1: approval-gated release with a cancellation branch
 *   for the staleness tests.
 */
describe('Workflow Foundation (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let workflow: WorkflowStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;
  const events: DomainEvent[] = [];

  const ROOT = { username: 'root', password: 'root-secret' };
  const LIMITED = { username: 'limited', password: 'limited-secret' };
  const OPERATOR = { username: 'operator', password: 'operator-secret' };

  let root: ReturnType<typeof request.agent>;
  let limited: ReturnType<typeof request.agent>;
  let operator: ReturnType<typeof request.agent>;

  const state = {
    orgId: '',
    otherOrgId: '',
    goodsDefinitionId: '',
    goodsV1Id: '',
    goodsV2Id: '',
    receivedId: '',
    inspectedId: '',
    postedId: '',
    inspectId: '',
    directPostId: '',
    postId: '',
    sealId: '',
    v2ReceiveId: '',
    v2CheckId: '',
    v2DispatchId: '',
    v2InspectId: '',
    paymentDefinitionId: '',
    paymentV1Id: '',
    pendingId: '',
    releasedId: '',
    voidedId: '',
    releaseId: '',
    cancelId: '',
    automationId: '',
    v1BindingId: '',
    goodsBindingId: '',
    approvalBindingId: '',
  };

  const org = () => ({ organizationId: state.orgId });

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    workflow = createWorkflowStores();
    const rebuilt = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue(buildPrismaStub())
          .overrideProvider(UsersRepository)
          .useValue(stores.users)
          .overrideProvider(SessionsRepository)
          .useValue(stores.sessions)
          .overrideProvider(PermissionsRepository)
          .useValue(stores.permissions)
          .overrideProvider(RolesRepository)
          .useValue(stores.roles)
          .overrideProvider(UserRolesRepository)
          .useValue(stores.userRoles)
          .overrideProvider(OrganizationsRepository)
          .useValue(master.organizations)
          .overrideProvider(WorkflowDefinitionsRepository)
          .useValue(workflow.definitions)
          .overrideProvider(WorkflowVersionsRepository)
          .useValue(workflow.versions)
          .overrideProvider(WorkflowStatesRepository)
          .useValue(workflow.states)
          .overrideProvider(WorkflowTransitionsRepository)
          .useValue(workflow.transitions)
          .overrideProvider(WorkflowInstancesRepository)
          .useValue(workflow.instances)
          .overrideProvider(WorkflowHistoryRepository)
          .useValue(workflow.history)
          .overrideProvider(WorkflowApprovalsRepository)
          .useValue(workflow.approvals)
          .overrideProvider(WorkflowAutomationsRepository)
          .useValue(workflow.automations),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    // The owning modules register their actions at startup. Task 9 owns
    // none, so the fixture stands in for a future automation dispatcher.
    app
      .get(AutomationActionRegistry)
      .register([
        { action: 'notify', name: 'Notify', description: 'Test notifier.' },
      ]);

    const bus = app.get<DomainEventBus>(DOMAIN_EVENT_BUS);
    for (const type of [
      WORKFLOW_VERSION_PUBLISHED_EVENT,
      WORKFLOW_INSTANCE_BOUND_EVENT,
      WORKFLOW_TRANSITION_COMPLETED_EVENT,
      WORKFLOW_APPROVAL_DECIDED_EVENT,
    ]) {
      bus.on(type, (event) => {
        events.push(event);
      });
    }

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);
    expect(allCodes).toContain(WORKFLOW_DEFINITION_PERMISSIONS.CREATE);
    expect(allCodes).toContain(WORKFLOW_VERSION_PERMISSIONS.PUBLISH);
    expect(allCodes).toContain(WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE);

    // Bootstrap administrator — system context, no HTTP request in flight.
    const rootUser = await users.createUser({
      username: ROOT.username,
      password: ROOT.password,
    });
    const rootRole = await roles.createRole({
      name: 'Root',
      description: 'Bootstrap administrator (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(rootRole.id, rootUser.id);

    // Read-only principal for the per-operation authorization surface.
    const limitedUser = await users.createUser({
      username: LIMITED.username,
      password: LIMITED.password,
    });
    const viewerRole = await roles.createRole({
      name: 'WorkflowViewer',
      description: 'Read-only workflow (test fixture)',
      permissionCodes: allCodes.filter((code) => code.endsWith('.View')),
    });
    await userRoles.assignRoleToUser(viewerRole.id, limitedUser.id);

    // Runtime operator: may execute transitions but holds no publish
    // permission, so Publish-gated transitions must fail at the
    // SERVICE layer even though the guard lets the request through.
    const operatorUser = await users.createUser({
      username: OPERATOR.username,
      password: OPERATOR.password,
    });
    const operatorRole = await roles.createRole({
      name: 'WorkflowOperator',
      description: 'Workflow runtime operator (test fixture)',
      permissionCodes: [
        WORKFLOW_DEFINITION_PERMISSIONS.VIEW,
        WORKFLOW_VERSION_PERMISSIONS.VIEW,
        WORKFLOW_INSTANCE_PERMISSIONS.VIEW,
        WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      ],
    });
    await userRoles.assignRoleToUser(operatorRole.id, operatorUser.id);

    root = request.agent(app.getHttpServer());
    limited = request.agent(app.getHttpServer());
    operator = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await limited.post('/api/v1/auth/login').send(LIMITED).expect(200);
    await operator.post('/api/v1/auth/login').send(OPERATOR).expect(200);

    const orgRes = await root
      .post('/api/v1/organizations')
      .send({ code: 'ACME', name: 'Acme Industries' })
      .expect(201);
    state.orgId = orgRes.body.id as string;
    const other = await root
      .post('/api/v1/organizations')
      .send({ code: 'OTHER', name: 'Other Co' })
      .expect(201);
    state.otherOrgId = other.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  function lastEvent(type: string): DomainEvent {
    const found = events.filter((event) => event.type === type).at(-1);
    expect(found).toBeDefined();
    return found as DomainEvent;
  }

  // ---- security surface ----------------------------------------------------

  it('rejects anonymous calls with 401 (not 403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/workflow/definitions')
      .query(org())
      .expect(401);
    expect(res.body.code).toBe('Unauthorized');
  });

  it('lets a viewer read but forbids every workflow write at the guard', async () => {
    await limited.get('/api/v1/workflow/definitions').query(org()).expect(200);

    const deniedDefinition = await limited
      .post('/api/v1/workflow/definitions')
      .send({
        organizationId: state.orgId,
        code: 'nope',
        name: 'Nope',
      })
      .expect(403);
    expect(deniedDefinition.body.code).toBe('PermissionDenied');

    const deniedBind = await limited
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: generateId(),
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(403);
    expect(deniedBind.body.code).toBe('PermissionDenied');

    const deniedExecute = await limited
      .post(`/api/v1/workflow/instances/${generateId()}/transitions`)
      .query(org())
      .send({ transitionId: generateId() })
      .expect(403);
    expect(deniedExecute.body.code).toBe('PermissionDenied');

    const deniedPublish = await limited
      .post(`/api/v1/workflow/versions/${generateId()}/publish`)
      .query(org())
      .expect(403);
    expect(deniedPublish.body.code).toBe('PermissionDenied');
  });

  it('requires organizationId on every list (no cross-tenant listing)', async () => {
    const res = await root.get('/api/v1/workflow/definitions').expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('rejects unknown sort fields with 400', async () => {
    const res = await root
      .get('/api/v1/workflow/definitions')
      .query({ organizationId: state.orgId, sort: 'nope:asc' })
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('exposes no version update and no history mutation routes', async () => {
    await root
      .patch(`/api/v1/workflow/versions/${generateId()}`)
      .query(org())
      .send({})
      .expect(404);
    await root
      .put(`/api/v1/workflow/instances/${generateId()}/history`)
      .send({})
      .expect(404);
    await root
      .delete(`/api/v1/workflow/instances/${generateId()}/history`)
      .expect(404);
  });

  // ---- definitions ---------------------------------------------------------

  it('creates, reads, updates and lists a definition', async () => {
    const created = await root
      .post('/api/v1/workflow/definitions')
      .send({
        organizationId: state.orgId,
        code: 'goods_receipt',
        name: 'Goods receipt',
        description: 'Three-way match lite.',
      })
      .expect(201);
    expect(created.body.code).toBe('goods_receipt');
    state.goodsDefinitionId = created.body.id as string;

    const fetched = await root
      .get(`/api/v1/workflow/definitions/${state.goodsDefinitionId}`)
      .query(org())
      .expect(200);
    expect(fetched.body.name).toBe('Goods receipt');

    const updated = await root
      .patch(`/api/v1/workflow/definitions/${state.goodsDefinitionId}`)
      .query(org())
      .send({ name: 'Goods receipt v2' })
      .expect(200);
    expect(updated.body.name).toBe('Goods receipt v2');
    expect(updated.body.code).toBe('goods_receipt');

    const listed = await root
      .get('/api/v1/workflow/definitions')
      .query({ organizationId: state.orgId, search: 'goods' })
      .expect(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].id).toBe(state.goodsDefinitionId);
  });

  it('rejects code changes, duplicates and cross-org definition access', async () => {
    // Codes are immutable: the update contract has no `code` field and the
    // global pipe forbids non-whitelisted properties.
    await root
      .patch(`/api/v1/workflow/definitions/${state.goodsDefinitionId}`)
      .query(org())
      .send({ code: 'renamed' })
      .expect(400);

    const duplicate = await root
      .post('/api/v1/workflow/definitions')
      .send({
        organizationId: state.orgId,
        code: 'goods_receipt',
        name: 'Duplicate',
      })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    // Uniques are org-scoped: the same code is free in another org.
    await root
      .post('/api/v1/workflow/definitions')
      .send({
        organizationId: state.otherOrgId,
        code: 'goods_receipt',
        name: 'Other goods receipt',
      })
      .expect(201);

    const crossOrg = await root
      .get(`/api/v1/workflow/definitions/${state.goodsDefinitionId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    expect(crossOrg.body.code).toBe('EntityNotFound');
  });

  // ---- versions, states, transitions (draft configuration) -----------------

  it('creates a draft version and configures its states', async () => {
    const created = await root
      .post(`/api/v1/workflow/definitions/${state.goodsDefinitionId}/versions`)
      .query(org())
      .send({})
      .expect(201);
    expect(created.body.versionNumber).toBe(1);
    expect(created.body.status).toBe('draft');
    state.goodsV1Id = created.body.id as string;

    const received = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .send({ code: 'received', name: 'Received', isInitial: true })
      .expect(201);
    state.receivedId = received.body.id as string;

    const inspected = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .send({ code: 'inspected', name: 'Inspected' })
      .expect(201);
    state.inspectedId = inspected.body.id as string;

    const posted = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .send({ code: 'posted', name: 'Posted', isTerminal: true })
      .expect(201);
    state.postedId = posted.body.id as string;

    const duplicate = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .send({ code: 'received', name: 'Again' })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    const malformed = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .send({ code: 'Received', name: 'Caps' })
      .expect(400);
    expect(malformed.body.code).toBe('ValidationFailed');

    const updated = await root
      .patch(`/api/v1/workflow/states/${state.inspectedId}`)
      .query(org())
      .send({ name: 'Inspected goods' })
      .expect(200);
    expect(updated.body.name).toBe('Inspected goods');
  });

  it('creates the payment definition, version and states', async () => {
    const created = await root
      .post('/api/v1/workflow/definitions')
      .send({
        organizationId: state.orgId,
        code: 'payment_release',
        name: 'Payment release',
      })
      .expect(201);
    state.paymentDefinitionId = created.body.id as string;

    const version = await root
      .post(
        `/api/v1/workflow/definitions/${state.paymentDefinitionId}/versions`,
      )
      .query(org())
      .send({})
      .expect(201);
    state.paymentV1Id = version.body.id as string;

    const pending = await root
      .post(`/api/v1/workflow/versions/${state.paymentV1Id}/states`)
      .query(org())
      .send({ code: 'pending', name: 'Pending', isInitial: true })
      .expect(201);
    state.pendingId = pending.body.id as string;

    const released = await root
      .post(`/api/v1/workflow/versions/${state.paymentV1Id}/states`)
      .query(org())
      .send({ code: 'released', name: 'Released', isTerminal: true })
      .expect(201);
    state.releasedId = released.body.id as string;

    const voided = await root
      .post(`/api/v1/workflow/versions/${state.paymentV1Id}/states`)
      .query(org())
      .send({ code: 'voided', name: 'Voided', isTerminal: true })
      .expect(201);
    state.voidedId = voided.body.id as string;
  });

  it('configures transitions and rejects invalid ones', async () => {
    const inspect = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'inspect',
        name: 'Inspect',
        sourceStateId: state.receivedId,
        targetStateId: state.inspectedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(201);
    state.inspectId = inspect.body.id as string;

    const directPost = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'direct_post',
        name: 'Direct post',
        sourceStateId: state.receivedId,
        targetStateId: state.postedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(201);
    state.directPostId = directPost.body.id as string;

    const post = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'post',
        name: 'Post',
        sourceStateId: state.inspectedId,
        targetStateId: state.postedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
        requiresComment: true,
      })
      .expect(201);
    state.postId = post.body.id as string;

    // Publish-gated branch: the operator holds Execute but not Publish, so
    // this transition exercises the service-layer re-check.
    const seal = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'seal',
        name: 'Seal',
        sourceStateId: state.inspectedId,
        targetStateId: state.postedId,
        requiredPermission: WORKFLOW_VERSION_PERMISSIONS.PUBLISH,
      })
      .expect(201);
    state.sealId = seal.body.id as string;

    const duplicate = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'inspect',
        name: 'Again',
        sourceStateId: state.receivedId,
        targetStateId: state.inspectedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    const selfLoop = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'loop',
        name: 'Loop',
        sourceStateId: state.receivedId,
        targetStateId: state.receivedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(400);
    expect(selfLoop.body.code).toBe('BadRequest');

    const unknownPermission = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'ghost',
        name: 'Ghost',
        sourceStateId: state.receivedId,
        targetStateId: state.inspectedId,
        requiredPermission: 'Never.Registered.Anything',
      })
      .expect(422);
    expect(unknownPermission.body.code).toBe('BusinessRuleViolation');

    const terminalSource = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'reopen',
        name: 'Reopen',
        sourceStateId: state.postedId,
        targetStateId: state.receivedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(422);
    expect(terminalSource.body.code).toBe('BusinessRuleViolation');

    const crossVersion = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'teleport',
        name: 'Teleport',
        sourceStateId: state.receivedId,
        targetStateId: state.pendingId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(422);
    expect(crossVersion.body.code).toBe('BusinessRuleViolation');
  });

  it('refuses to delete a state that transitions touch', async () => {
    const touched = await root
      .delete(`/api/v1/workflow/states/${state.receivedId}`)
      .query(org())
      .expect(422);
    expect(touched.body.code).toBe('BusinessRuleViolation');

    // An untouched state deletes cleanly.
    const spare = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .send({ code: 'spare', name: 'Spare' })
      .expect(201);
    await root
      .delete(`/api/v1/workflow/states/${spare.body.id as string}`)
      .query(org())
      .expect(204);
  });

  // ---- automations (draft catalogue bindings) --------------------------------

  it('binds a registered automation action and rejects unknown ones', async () => {
    const unknown = await root
      .post(`/api/v1/workflow/transitions/${state.inspectId}/automations`)
      .query(org())
      .send({ action: 'nope' })
      .expect(422);
    expect(unknown.body.code).toBe('BusinessRuleViolation');

    const created = await root
      .post(`/api/v1/workflow/transitions/${state.inspectId}/automations`)
      .query(org())
      .send({ action: 'notify', parameters: { channel: 'warehouse' } })
      .expect(201);
    state.automationId = created.body.id as string;
    expect(created.body.action).toBe('notify');

    const duplicate = await root
      .post(`/api/v1/workflow/transitions/${state.inspectId}/automations`)
      .query(org())
      .send({ action: 'notify' })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    const updated = await root
      .patch(`/api/v1/workflow/automations/${state.automationId}`)
      .query(org())
      .send({ isActive: false })
      .expect(200);
    expect(updated.body.isActive).toBe(false);

    await root
      .patch(`/api/v1/workflow/automations/${state.automationId}`)
      .query(org())
      .send({ isActive: true })
      .expect(200);

    const listed = await root
      .get(`/api/v1/workflow/transitions/${state.inspectId}/automations`)
      .query(org())
      .expect(200);
    expect(listed.body.total).toBe(1);
  });

  // ---- publish ---------------------------------------------------------------

  it('refuses to publish a stateless draft', async () => {
    // Payment v1 holds states but no transitions yet — publishable in
    // principle, so this test publishes a genuinely empty v2 draft.
    const empty = await root
      .post(
        `/api/v1/workflow/definitions/${state.paymentDefinitionId}/versions`,
      )
      .query(org())
      .send({})
      .expect(201);
    const res = await root
      .post(`/api/v1/workflow/versions/${empty.body.id as string}/publish`)
      .query(org())
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  it('configures and publishes the payment workflow', async () => {
    const release = await root
      .post(`/api/v1/workflow/versions/${state.paymentV1Id}/transitions`)
      .query(org())
      .send({
        code: 'release',
        name: 'Release',
        sourceStateId: state.pendingId,
        targetStateId: state.releasedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
        requiresApproval: true,
      })
      .expect(201);
    state.releaseId = release.body.id as string;

    const cancel = await root
      .post(`/api/v1/workflow/versions/${state.paymentV1Id}/transitions`)
      .query(org())
      .send({
        code: 'cancel',
        name: 'Cancel',
        sourceStateId: state.pendingId,
        targetStateId: state.voidedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(201);
    state.cancelId = cancel.body.id as string;

    const published = await root
      .post(`/api/v1/workflow/versions/${state.paymentV1Id}/publish`)
      .query(org())
      .expect(200);
    expect(published.body.status).toBe('active');
  });

  it('publishes goods v1 and freezes its configuration', async () => {
    const published = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/publish`)
      .query(org())
      .expect(200);
    expect(published.body.status).toBe('active');

    const event = lastEvent(WORKFLOW_VERSION_PUBLISHED_EVENT);
    expect(event.aggregateId).toBe(state.goodsV1Id);

    const republish = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/publish`)
      .query(org())
      .expect(422);
    expect(republish.body.code).toBe('BusinessRuleViolation');

    // Every configuration write against the active version is a 422.
    const frozenState = await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .send({ code: 'late', name: 'Late' })
      .expect(422);
    expect(frozenState.body.code).toBe('BusinessRuleViolation');

    await root
      .patch(`/api/v1/workflow/states/${state.receivedId}`)
      .query(org())
      .send({ name: 'Changed' })
      .expect(422);
    await root
      .delete(`/api/v1/workflow/states/${state.receivedId}`)
      .query(org())
      .expect(422);

    await root
      .post(`/api/v1/workflow/versions/${state.goodsV1Id}/transitions`)
      .query(org())
      .send({
        code: 'late',
        name: 'Late',
        sourceStateId: state.receivedId,
        targetStateId: state.inspectedId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(422);
    await root
      .patch(`/api/v1/workflow/transitions/${state.inspectId}`)
      .query(org())
      .send({ name: 'Changed' })
      .expect(422);
    await root
      .delete(`/api/v1/workflow/transitions/${state.inspectId}`)
      .query(org())
      .expect(422);

    await root
      .post(`/api/v1/workflow/transitions/${state.inspectId}/automations`)
      .query(org())
      .send({ action: 'notify' })
      .expect(422);
    await root
      .patch(`/api/v1/workflow/automations/${state.automationId}`)
      .query(org())
      .send({ isActive: false })
      .expect(422);
    await root
      .delete(`/api/v1/workflow/automations/${state.automationId}`)
      .query(org())
      .expect(422);

    // Reads still work on the frozen version.
    await root
      .get(`/api/v1/workflow/versions/${state.goodsV1Id}/states`)
      .query(org())
      .expect(200);
    await root
      .get(`/api/v1/workflow/transitions/${state.inspectId}/automations`)
      .query(org())
      .expect(200);
  });

  // ---- v1 runtime (before supersession pins new bindings to v2) ----------------

  it('binds a v1 instance and reports bound automations on completion', async () => {
    const bound = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(201);
    expect(bound.body.versionId).toBe(state.goodsV1Id);
    expect(bound.body.currentStateId).toBe(state.receivedId);
    state.v1BindingId = bound.body.id as string;

    const boundEvent = lastEvent(WORKFLOW_INSTANCE_BOUND_EVENT);
    expect(boundEvent.aggregateId).toBe(state.v1BindingId);

    const executed = await root
      .post(`/api/v1/workflow/instances/${state.v1BindingId}/transitions`)
      .query(org())
      .send({ transitionId: state.inspectId })
      .expect(200);
    expect(executed.body.history.sequence).toBe(1);
    expect(executed.body.instance.currentStateId).toBe(state.inspectedId);

    const event = lastEvent(WORKFLOW_TRANSITION_COMPLETED_EVENT);
    const payload = event.payload as {
      instanceId: string;
      transitionCode: string;
      sequence: number;
      automations: unknown[];
    };
    expect(payload.instanceId).toBe(state.v1BindingId);
    expect(payload.transitionCode).toBe('inspect');
    expect(payload.sequence).toBe(1);
    expect(payload.automations).toEqual([
      { action: 'notify', parameters: { channel: 'warehouse' } },
    ]);
  });

  it('enforces the transition permission at the service layer (no bypass)', async () => {
    const available = await operator
      .get(
        `/api/v1/workflow/instances/${state.v1BindingId}/available-transitions`,
      )
      .query(org())
      .expect(200);
    expect(available.body.isTerminal).toBe(false);
    const preview = new Map(
      (
        available.body.transitions as Array<{
          code: string;
          permitted: boolean;
        }>
      ).map((transition) => [transition.code, transition.permitted]),
    );
    expect([...preview.keys()].sort()).toEqual(['post', 'seal']);
    expect(preview.get('post')).toBe(true);
    expect(preview.get('seal')).toBe(false);

    // The guard passes (the operator holds Execute) but the service denies:
    // `seal` requires Publish, which the operator lacks.
    const forbidden = await operator
      .post(`/api/v1/workflow/instances/${state.v1BindingId}/transitions`)
      .query(org())
      .send({ transitionId: state.sealId })
      .expect(403);
    expect(forbidden.body.code).toBe('PermissionDenied');

    // A transition whose own permission the operator HOLDS executes.
    await operator
      .post(`/api/v1/workflow/instances/${state.v1BindingId}/transitions`)
      .query(org())
      .send({ transitionId: state.postId, comment: 'Looks good.' })
      .expect(200);

    const terminal = await root
      .get(
        `/api/v1/workflow/instances/${state.v1BindingId}/available-transitions`,
      )
      .query(org())
      .expect(200);
    expect(terminal.body.isTerminal).toBe(true);
    expect(terminal.body.transitions).toEqual([]);
  });

  it('requires a comment where the transition demands one', async () => {
    const bound = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(201);

    await root
      .post(`/api/v1/workflow/instances/${bound.body.id as string}/transitions`)
      .query(org())
      .send({ transitionId: state.inspectId })
      .expect(200);

    const missing = await root
      .post(`/api/v1/workflow/instances/${bound.body.id as string}/transitions`)
      .query(org())
      .send({ transitionId: state.postId })
      .expect(422);
    expect(missing.body.code).toBe('BusinessRuleViolation');

    await root
      .post(`/api/v1/workflow/instances/${bound.body.id as string}/transitions`)
      .query(org())
      .send({ transitionId: state.postId, comment: 'Posting.' })
      .expect(200);
  });

  it('publishes a superseding v2 while v1 bindings stay pinned', async () => {
    const created = await root
      .post(`/api/v1/workflow/definitions/${state.goodsDefinitionId}/versions`)
      .query(org())
      .send({})
      .expect(201);
    expect(created.body.versionNumber).toBe(2);
    state.goodsV2Id = created.body.id as string;

    const received = await root
      .post(`/api/v1/workflow/versions/${state.goodsV2Id}/states`)
      .query(org())
      .send({ code: 'received', name: 'Received', isInitial: true })
      .expect(201);
    state.v2ReceiveId = received.body.id as string;

    const checked = await root
      .post(`/api/v1/workflow/versions/${state.goodsV2Id}/states`)
      .query(org())
      .send({ code: 'checked', name: 'Checked' })
      .expect(201);
    state.v2CheckId = checked.body.id as string;

    const dispatched = await root
      .post(`/api/v1/workflow/versions/${state.goodsV2Id}/states`)
      .query(org())
      .send({ code: 'dispatched', name: 'Dispatched', isTerminal: true })
      .expect(201);
    state.v2DispatchId = dispatched.body.id as string;

    const inspect = await root
      .post(`/api/v1/workflow/versions/${state.goodsV2Id}/transitions`)
      .query(org())
      .send({
        code: 'check',
        name: 'Check',
        sourceStateId: state.v2ReceiveId,
        targetStateId: state.v2CheckId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(201);
    state.v2InspectId = inspect.body.id as string;

    // Second branch from the same source for the concurrency race.
    await root
      .post(`/api/v1/workflow/versions/${state.goodsV2Id}/transitions`)
      .query(org())
      .send({
        code: 'dispatch_direct',
        name: 'Dispatch direct',
        sourceStateId: state.v2ReceiveId,
        targetStateId: state.v2DispatchId,
        requiredPermission: WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      })
      .expect(201);

    const published = await root
      .post(`/api/v1/workflow/versions/${state.goodsV2Id}/publish`)
      .query(org())
      .expect(200);
    expect(published.body.status).toBe('active');

    const superseded = await root
      .get(`/api/v1/workflow/versions/${state.goodsV1Id}`)
      .query(org())
      .expect(200);
    expect(superseded.body.status).toBe('superseded');

    // The pre-supersession binding still executes its pinned version.
    const pinned = await root
      .get(`/api/v1/workflow/instances/${state.v1BindingId}`)
      .query(org())
      .expect(200);
    expect(pinned.body.versionId).toBe(state.goodsV1Id);

    const history = await root
      .get(`/api/v1/workflow/instances/${state.v1BindingId}/history`)
      .query(org())
      .expect(200);
    expect(history.body.total).toBe(2);
    expect(
      history.body.items.map((row: { sequence: number }) => row.sequence),
    ).toEqual([1, 2]);
  });

  // ---- bindings ----------------------------------------------------------------

  it('binds entities to the active version and rejects the rest', async () => {
    const first = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(201);
    // Default binds resolve the ACTIVE version — v2 at this point.
    expect(first.body.versionId).toBe(state.goodsV2Id);
    expect(first.body.currentStateId).toBe(state.v2ReceiveId);

    const duplicate = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: first.body.entityId as string,
      })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    // An explicit version must be active: superseded v1 is rejected.
    const superseded = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        versionId: state.goodsV1Id,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(422);
    expect(superseded.body.code).toBe('BusinessRuleViolation');

    const malformed = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        entityModule: 'Inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(400);
    expect(malformed.body.code).toBe('ValidationFailed');
  });

  it('rejects bindings without an active version or with a disabled definition', async () => {
    const bare = await root
      .post('/api/v1/workflow/definitions')
      .send({
        organizationId: state.orgId,
        code: 'never_published',
        name: 'Never published',
      })
      .expect(201);

    const noActive = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: bare.body.id as string,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(422);
    expect(noActive.body.code).toBe('BusinessRuleViolation');

    const archived = await root
      .post('/api/v1/workflow/definitions')
      .send({
        organizationId: state.orgId,
        code: 'archived_flow',
        name: 'Archived flow',
      })
      .expect(201);
    await root
      .patch(`/api/v1/workflow/definitions/${archived.body.id as string}`)
      .query(org())
      .send({ isActive: false })
      .expect(200);

    await root
      .post(
        `/api/v1/workflow/definitions/${archived.body.id as string}/versions`,
      )
      .query(org())
      .send({})
      .expect(422);

    const disabled = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: archived.body.id as string,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(422);
    expect(disabled.body.code).toBe('BusinessRuleViolation');
  });

  // ---- v2 runtime ----------------------------------------------------------------

  it('lists v2 available transitions and executes one', async () => {
    const bound = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        versionId: state.goodsV2Id,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(201);
    state.goodsBindingId = bound.body.id as string;

    const available = await operator
      .get(
        `/api/v1/workflow/instances/${state.goodsBindingId}/available-transitions`,
      )
      .query(org())
      .expect(200);
    expect(available.body.isTerminal).toBe(false);
    expect(available.body.currentState.code).toBe('received');
    const codes = (available.body.transitions as Array<{ code: string }>)
      .map((transition) => transition.code)
      .sort();
    expect(codes).toEqual(['check', 'dispatch_direct']);

    const executed = await root
      .post(`/api/v1/workflow/instances/${state.goodsBindingId}/transitions`)
      .query(org())
      .send({ transitionId: state.v2InspectId })
      .expect(200);
    expect(executed.body.history.sequence).toBe(1);
    expect(executed.body.instance.currentStateId).toBe(state.v2CheckId);

    // v2's `check` binds no automations: the envelope is present but empty.
    const event = lastEvent(WORKFLOW_TRANSITION_COMPLETED_EVENT);
    const payload = event.payload as {
      instanceId: string;
      automations: unknown[];
    };
    expect(payload.instanceId).toBe(state.goodsBindingId);
    expect(payload.automations).toEqual([]);
  });

  it('rejects a transition from another version', async () => {
    // `release` belongs to payment v1, the binding to goods v2.
    const res = await root
      .post(`/api/v1/workflow/instances/${state.goodsBindingId}/transitions`)
      .query(org())
      .send({ transitionId: state.releaseId })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  // ---- approvals -----------------------------------------------------------------

  it('runs the approval journey: request, approve, execute', async () => {
    const bound = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.paymentDefinitionId,
        entityModule: 'accounting',
        entityType: 'payment_order',
        entityId: generateId(),
      })
      .expect(201);
    state.approvalBindingId = bound.body.id as string;

    const notRequired = await root
      .post(`/api/v1/workflow/instances/${state.approvalBindingId}/approvals`)
      .query(org())
      .send({ transitionId: state.cancelId })
      .expect(422);
    expect(notRequired.body.code).toBe('BusinessRuleViolation');

    // The operator holds the transition permission, so the request passes
    // both the guard and the service re-check.
    const requested = await operator
      .post(`/api/v1/workflow/instances/${state.approvalBindingId}/approvals`)
      .query(org())
      .send({ transitionId: state.releaseId })
      .expect(201);
    expect(requested.body.status).toBe('pending');
    expect(requested.body.baseSequence).toBe(0);

    const duplicate = await root
      .post(`/api/v1/workflow/instances/${state.approvalBindingId}/approvals`)
      .query(org())
      .send({ transitionId: state.releaseId })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    const without = await root
      .post(`/api/v1/workflow/instances/${state.approvalBindingId}/transitions`)
      .query(org())
      .send({ transitionId: state.releaseId })
      .expect(422);
    expect(without.body.code).toBe('BusinessRuleViolation');

    const decided = await root
      .post(`/api/v1/workflow/approvals/${requested.body.id as string}/decide`)
      .query(org())
      .send({ decision: 'approved' })
      .expect(200);
    expect(decided.body.status).toBe('approved');

    const event = lastEvent(WORKFLOW_APPROVAL_DECIDED_EVENT);
    expect(event.aggregateId).toBe(requested.body.id);

    const executed = await root
      .post(`/api/v1/workflow/instances/${state.approvalBindingId}/transitions`)
      .query(org())
      .send({
        transitionId: state.releaseId,
        approvalId: requested.body.id as string,
      })
      .expect(200);
    expect(executed.body.history.approvalId).toBe(requested.body.id);
    expect(executed.body.instance.currentStateId).toBe(state.releasedId);

    const history = await root
      .get(`/api/v1/workflow/instances/${state.approvalBindingId}/history`)
      .query(org())
      .expect(200);
    expect(history.body.total).toBe(1);
    expect(history.body.items[0].approvalId).toBe(requested.body.id);

    const approvals = await root
      .get(`/api/v1/workflow/instances/${state.approvalBindingId}/approvals`)
      .query({ organizationId: state.orgId, status: 'approved' })
      .expect(200);
    expect(approvals.body.total).toBe(1);
  });

  it('rejects rejected and stale approvals', async () => {
    const rejected = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.paymentDefinitionId,
        entityModule: 'accounting',
        entityType: 'payment_order',
        entityId: generateId(),
      })
      .expect(201);

    const requested = await root
      .post(
        `/api/v1/workflow/instances/${rejected.body.id as string}/approvals`,
      )
      .query(org())
      .send({ transitionId: state.releaseId })
      .expect(201);

    await root
      .post(`/api/v1/workflow/approvals/${requested.body.id as string}/decide`)
      .query(org())
      .send({ decision: 'rejected' })
      .expect(200);

    const redecide = await root
      .post(`/api/v1/workflow/approvals/${requested.body.id as string}/decide`)
      .query(org())
      .send({ decision: 'approved' })
      .expect(422);
    expect(redecide.body.code).toBe('BusinessRuleViolation');

    const useRejected = await root
      .post(
        `/api/v1/workflow/instances/${rejected.body.id as string}/transitions`,
      )
      .query(org())
      .send({
        transitionId: state.releaseId,
        approvalId: requested.body.id as string,
      })
      .expect(422);
    expect(useRejected.body.code).toBe('BusinessRuleViolation');

    // Stale: the workflow moved (cancel → voided) after the request.
    const stale = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.paymentDefinitionId,
        entityModule: 'accounting',
        entityType: 'payment_order',
        entityId: generateId(),
      })
      .expect(201);

    const staleRequest = await root
      .post(`/api/v1/workflow/instances/${stale.body.id as string}/approvals`)
      .query(org())
      .send({ transitionId: state.releaseId })
      .expect(201);

    await root
      .post(`/api/v1/workflow/instances/${stale.body.id as string}/transitions`)
      .query(org())
      .send({ transitionId: state.cancelId })
      .expect(200);

    const decideStale = await root
      .post(
        `/api/v1/workflow/approvals/${staleRequest.body.id as string}/decide`,
      )
      .query(org())
      .send({ decision: 'approved' })
      .expect(422);
    expect(decideStale.body.code).toBe('BusinessRuleViolation');
  });

  // ---- terminal behaviour, wrong-source, concurrency ------------------------------

  it('reports terminal states and rejects transitions from the wrong state', async () => {
    const bound = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        versionId: state.goodsV2Id,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(201);

    // Resolve the direct branch id (created without capturing it above).
    const available = await root
      .get(
        `/api/v1/workflow/instances/${bound.body.id as string}/available-transitions`,
      )
      .query(org())
      .expect(200);
    const direct = (
      available.body.transitions as Array<{ id: string; code: string }>
    ).find((transition) => transition.code === 'dispatch_direct');
    expect(direct).toBeDefined();

    await root
      .post(`/api/v1/workflow/instances/${bound.body.id as string}/transitions`)
      .query(org())
      .send({ transitionId: (direct as { id: string }).id })
      .expect(200);

    const terminal = await root
      .get(
        `/api/v1/workflow/instances/${bound.body.id as string}/available-transitions`,
      )
      .query(org())
      .expect(200);
    expect(terminal.body.isTerminal).toBe(true);
    expect(terminal.body.transitions).toEqual([]);

    // Any further transition from the terminal state loses the source race.
    const stale = await root
      .post(`/api/v1/workflow/instances/${bound.body.id as string}/transitions`)
      .query(org())
      .send({ transitionId: state.v2InspectId })
      .expect(409);
    expect(stale.body.code).toBe('Conflict');
  });

  it('serializes concurrent transitions: one winner, one 409', async () => {
    const bound = await root
      .post('/api/v1/workflow/instances')
      .send({
        organizationId: state.orgId,
        definitionId: state.goodsDefinitionId,
        versionId: state.goodsV2Id,
        entityModule: 'inventory',
        entityType: 'inventory_receipt',
        entityId: generateId(),
      })
      .expect(201);
    const instanceId = bound.body.id as string;

    const available = await root
      .get(`/api/v1/workflow/instances/${instanceId}/available-transitions`)
      .query(org())
      .expect(200);
    const byCode = new Map(
      (available.body.transitions as Array<{ id: string; code: string }>).map(
        (transition) => [transition.code, transition.id],
      ),
    );

    const [first, second] = await Promise.all([
      root
        .post(`/api/v1/workflow/instances/${instanceId}/transitions`)
        .query(org())
        .send({ transitionId: byCode.get('check') }),
      root
        .post(`/api/v1/workflow/instances/${instanceId}/transitions`)
        .query(org())
        .send({ transitionId: byCode.get('dispatch_direct') }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.code).toBe('Conflict');

    const history = await root
      .get(`/api/v1/workflow/instances/${instanceId}/history`)
      .query(org())
      .expect(200);
    expect(history.body.total).toBe(1);
    expect(history.body.items[0].sequence).toBe(1);

    const instance = await root
      .get(`/api/v1/workflow/instances/${instanceId}`)
      .query(org())
      .expect(200);
    expect([state.v2CheckId, state.v2DispatchId]).toContain(
      instance.body.currentStateId,
    );
  });

  // ---- history pagination ----------------------------------------------------------

  it('paginates history in sequence order', async () => {
    const history = await root
      .get(`/api/v1/workflow/instances/${state.goodsBindingId}/history`)
      .query({ organizationId: state.orgId, page: 1, pageSize: 1 })
      .expect(200);
    expect(history.body.total).toBe(1);
    expect(history.body.page).toBe(1);
    expect(history.body.pageSize).toBe(1);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0].sequence).toBe(1);
  });

  // ---- organization isolation -------------------------------------------------------

  it('isolates every workflow row by organization', async () => {
    const other = { organizationId: state.otherOrgId };

    const definition = await root
      .get(`/api/v1/workflow/definitions/${state.goodsDefinitionId}`)
      .query(other)
      .expect(404);
    expect(definition.body.code).toBe('EntityNotFound');

    await root
      .get(`/api/v1/workflow/versions/${state.goodsV2Id}`)
      .query(other)
      .expect(404);
    await root
      .get(`/api/v1/workflow/states/${state.v2ReceiveId}`)
      .query(other)
      .expect(404);
    await root
      .get(`/api/v1/workflow/transitions/${state.v2InspectId}`)
      .query(other)
      .expect(404);
    await root
      .get(`/api/v1/workflow/instances/${state.goodsBindingId}`)
      .query(other)
      .expect(404);
    await root
      .get(
        `/api/v1/workflow/instances/${state.goodsBindingId}/available-transitions`,
      )
      .query(other)
      .expect(404);
    await root
      .get(`/api/v1/workflow/instances/${state.goodsBindingId}/history`)
      .query(other)
      .expect(404);

    const execute = await root
      .post(`/api/v1/workflow/instances/${state.goodsBindingId}/transitions`)
      .query(other)
      .send({ transitionId: state.v2InspectId })
      .expect(404);
    expect(execute.body.code).toBe('EntityNotFound');

    // OTHER sees only its own definition copy.
    const listed = await root
      .get('/api/v1/workflow/definitions')
      .query(other)
      .expect(200);
    expect(listed.body.total).toBe(1);

    const instances = await root
      .get('/api/v1/workflow/instances')
      .query(other)
      .expect(200);
    expect(instances.body.total).toBe(0);
  });

  function buildPrismaStub(): PrismaService {
    const fail = (): never => {
      throw new Error('PrismaService must not be touched in e2e tests.');
    };
    return {
      getClient: fail,
      onModuleInit: async () => {},
      onModuleDestroy: async () => {},
      $transaction: fail,
    } as unknown as PrismaService;
  }
});
