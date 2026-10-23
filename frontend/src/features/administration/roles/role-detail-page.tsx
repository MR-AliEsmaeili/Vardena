import { useMemo, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  listUsers,
  assignRolePermission,
  removeRolePermission,
  assignUserToRole,
  removeUserFromRole,
} from '@/api/admin.api';
import type { AdminPermission } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { usePermissions } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatCount, formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { DataTable } from '@/ui/patterns/data-table';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { Definition, DefinitionList } from '../administration-ui';
import {
  administrationErrorMessage,
  administrationSuccessMessage,
} from '../administration-error-messages';
import { usePermissionRegistry, useRoleDetail } from './role-hooks';

/** Mirror of `class-validator`'s `@IsUlid` (Crockford base32, 26 chars). */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Role detail (`GET /roles/:id`) with the role's OWN operations.
 *
 * - Permissions: assign one code from the registry (204; 409 = already
 *   assigned) and remove an assigned one (204; 404 = assignment already
 *   gone). Both confirm first — a permission change reaches every user of
 *   the role immediately.
 * - Users: the backend exposes NO read of role↔user assignments, so this
 *   panel only offers the two mutations and reports their 409/404 honestly
 *   (the section hint says exactly that).
 */
export function RoleDetailPage(): ReactElement {
  const { roleId } = useParams<{ roleId: string }>();
  const query = useRoleDetail(roleId);

  if (query.isPending) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.rolesAdmin.roleDetail} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.rolesAdmin.roleLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const role = query.data;
  const editTo = `/app/admin/roles/${encodeURIComponent(role.id)}/edit`;

  return (
    <div className="space-y-4" data-testid="role-detail-page">
      <PageHeader
        title={t.rolesAdmin.roleDetail}
        description={t.rolesAdmin.subtitle}
        actions={
          <PermissionGate permission={PERMISSIONS.rbac.roleEdit}>
            <Button asChild size="sm" variant="outline">
              <Link to={editTo}>{t.rolesAdmin.edit}</Link>
            </Button>
          </PermissionGate>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{role.name}</CardTitle>
          <CardDescription>
            {role.description === null || role.description === ''
              ? t.rolesAdmin.noDescription
              : role.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DefinitionList>
            <Definition label={t.rolesAdmin.roleName}>{role.name}</Definition>
            <Definition label={t.rolesAdmin.permissionCount}>
              <span className="num">{formatCount(role.permissionCount)}</span>
            </Definition>
            <Definition label={t.rolesAdmin.createdAt}>
              <span className="num">{formatDateTime(role.createdAt)}</span>
            </Definition>
            <Definition label={t.rolesAdmin.updatedAt}>
              <span className="num">{formatDateTime(role.updatedAt)}</span>
            </Definition>
          </DefinitionList>
        </CardContent>
      </Card>

      <RolePermissionsCard roleId={role.id} permissions={role.permissions} />
      <RoleUsersCard roleId={role.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions of the role
// ---------------------------------------------------------------------------

interface PermissionsTableHandlers {
  canRemove: boolean;
  pending: boolean;
  onRemove: (code: string) => void;
}

function rolePermissionsColumns({
  canRemove,
  pending,
  onRemove,
}: PermissionsTableHandlers): ColumnDef<AdminPermission, unknown>[] {
  return [
    {
      accessorKey: 'code',
      header: t.rolesAdmin.permissionCode,
      cell: ({ row }) => (
        <span className="code text-xs font-medium text-ink" dir="ltr">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: 'description',
      header: t.rolesAdmin.permissionDescription,
      enableSorting: false,
    },
    {
      id: 'actions',
      header: t.rolesAdmin.actions,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) =>
        canRemove ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onRemove(row.original.code)}
          >
            {t.rolesAdmin.removePermission}
          </Button>
        ) : null,
    },
  ];
}

function RolePermissionsCard({
  roleId,
  permissions,
}: {
  roleId: string;
  permissions: AdminPermission[];
}): ReactElement {
  const { showToast } = useToast();
  const checks = usePermissions();
  const [addError, setAddError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [removingCode, setRemovingCode] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  const registry = usePermissionRegistry(
    checks.has(PERMISSIONS.rbac.rolePermissionAssign),
  );

  const assignedCodes = new Set(
    permissions.map((permission) => permission.code),
  );
  const available = (registry.data?.items ?? []).filter(
    (permission) => !assignedCodes.has(permission.code),
  );

  const closeAdd = () => {
    setAddOpen(false);
    setAddCode('');
    setAddError(null);
  };

  const submitAdd = () => {
    if (addCode === '') {
      setAddError(t.rolesAdmin.permissionRequired);
      return;
    }
    setPendingCode(addCode);
    assignRolePermission(roleId, addCode)
      .then(() => {
        setPendingCode(null);
        closeAdd();
        showToast({
          kind: 'success',
          message: administrationSuccessMessage('role', 'assign'),
        });
      })
      .catch((error: unknown) => {
        setPendingCode(null);
        const normalized = normalizeApiError(error);
        if (normalized.isUnauthorized) return;
        // The dialog STAYS OPEN and renders the mapped message inside it.
        setAddError(
          administrationErrorMessage('role', 'assign', error).message,
        );
      });
  };

  const submitRemove = (code: string) => {
    setPendingCode(code);
    setRemoveError(null);
    removeRolePermission(roleId, code)
      .then(() => {
        setPendingCode(null);
        setRemovingCode(null);
        showToast({
          kind: 'success',
          message: administrationSuccessMessage('role', 'remove'),
        });
      })
      .catch((error: unknown) => {
        setPendingCode(null);
        const normalized = normalizeApiError(error);
        if (normalized.isUnauthorized) return;
        setRemoveError(
          administrationErrorMessage('role', 'remove', error).message,
        );
      });
  };

  const canRemove = checks.has(PERMISSIONS.rbac.rolePermissionRemove);
  const columns = useMemo(
    () =>
      rolePermissionsColumns({
        canRemove,
        pending: pendingCode !== null,
        onRemove: setRemovingCode,
      }),
    [canRemove, pendingCode],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.rolesAdmin.permissionsSection}</CardTitle>
        <CardDescription>{t.rolesAdmin.permissionsSectionHint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <PermissionGate permission={PERMISSIONS.rbac.rolePermissionAssign}>
          <div>
            <Button
              size="sm"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              {t.rolesAdmin.addPermission}
            </Button>
          </div>
        </PermissionGate>

        {removeError !== null && removingCode === null && (
          <p role="alert" className="text-sm text-danger-ink">
            {removeError}
          </p>
        )}

        <DataTable
          columns={columns}
          data={permissions}
          getRowId={(row) => row.code}
          caption={t.rolesAdmin.permissionsSection}
          isLoading={false}
          emptyTitle={t.rolesAdmin.permissionsSection}
          emptyDescription={t.rolesAdmin.permissionsEmpty}
        />

        <ConfirmDialog
          open={addOpen}
          title={t.rolesAdmin.addPermissionTitle}
          description={t.rolesAdmin.addPermissionBody}
          confirmLabel={t.rolesAdmin.addPermission}
          loadingLabel={t.rolesAdmin.assigning}
          loading={pendingCode !== null}
          error={addError}
          onConfirm={submitAdd}
          onCancel={closeAdd}
        >
          <div className="space-y-1.5">
            <label
              htmlFor="assign-permission-code"
              className="block text-sm font-medium text-ink-muted"
            >
              {t.rolesAdmin.permissionCode}
            </label>
            <Select
              id="assign-permission-code"
              value={addCode}
              disabled={pendingCode !== null || registry.isPending}
              onChange={(event) => setAddCode(event.target.value)}
            >
              <option value="">{t.rolesAdmin.permissionRequired}</option>
              {available.map((permission) => (
                <option key={permission.code} value={permission.code}>
                  {permission.code} — {permission.description}
                </option>
              ))}
            </Select>
            {registry.isPending && (
              <p className="text-xs text-ink-subtle">{t.app.loading}</p>
            )}
            {registry.isError && (
              <p role="alert" className="text-xs text-danger-ink">
                {t.rolesAdmin.registryLoadFailed}
              </p>
            )}
          </div>
        </ConfirmDialog>

        <ConfirmDialog
          open={removingCode !== null}
          title={t.rolesAdmin.removePermissionTitle}
          description={t.rolesAdmin.removePermissionBody}
          confirmLabel={t.rolesAdmin.removePermission}
          loadingLabel={t.rolesAdmin.removing}
          loading={pendingCode !== null}
          danger
          error={removeError}
          onConfirm={() => {
            if (removingCode !== null) submitRemove(removingCode);
          }}
          onCancel={() => {
            setRemovingCode(null);
            setRemoveError(null);
          }}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// User assignment (no backend read exists — mutations only)
// ---------------------------------------------------------------------------

/**
 * The user picker behind `Users.User.View`: a select over the (bounded)
 * user list when readable, otherwise — and for overflows — manual ULID
 * entry. `mode` picks which control renders.
 */
function UserSelectionFields({
  mode,
  userId,
  manualId,
  disabled,
  onUserIdChange,
  onManualChange,
}: {
  mode: 'select' | 'manual';
  userId: string;
  manualId: string;
  disabled: boolean;
  onUserIdChange: (value: string) => void;
  onManualChange: (value: string) => void;
}): ReactElement {
  const users = useQuery({
    queryKey: queryKeys.users.list({ reference: 'picker' }),
    queryFn: ({ signal }) =>
      listUsers({ page: 1, pageSize: 200, sort: 'username:asc' }, signal),
    enabled: mode === 'select',
    staleTime: 5 * 60 * 1000,
  });

  // A failed registry read degrades to manual ULID entry instead of a dead
  // select — the picker is a convenience, never a hard dependency.
  if (mode === 'select' && !users.isError) {
    const items = users.data?.items ?? [];
    const truncated =
      users.data !== undefined && users.data.total > items.length;
    return (
      <div className="space-y-2">
        <label
          htmlFor="role-user-select"
          className="block text-sm font-medium text-ink-muted"
        >
          {t.usersAdmin.username}
        </label>
        <Select
          id="role-user-select"
          value={userId}
          disabled={disabled || users.isPending}
          onChange={(event) => onUserIdChange(event.target.value)}
        >
          <option value="">{t.rolesAdmin.userIdRequired}</option>
          {items.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username}
              {user.isActive ? '' : ` (${t.usersAdmin.inactive})`}
            </option>
          ))}
        </Select>
        {users.isPending && (
          <p className="text-xs text-ink-subtle">{t.app.loading}</p>
        )}
        {truncated && (
          <div className="space-y-1.5">
            <label
              htmlFor="role-user-manual"
              className="block text-sm font-medium text-ink-muted"
            >
              {t.rolesAdmin.usersPickerUnavailable}
            </label>
            <Input
              id="role-user-manual"
              type="text"
              dir="ltr"
              className="code"
              value={manualId}
              disabled={disabled}
              onChange={(event) => onManualChange(event.target.value)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="role-user-manual"
        className="block text-sm font-medium text-ink-muted"
      >
        {t.rolesAdmin.usersPickerUnavailable}
      </label>
      <Input
        id="role-user-manual"
        type="text"
        dir="ltr"
        className="code"
        value={manualId}
        disabled={disabled}
        onChange={(event) => onManualChange(event.target.value)}
      />
    </div>
  );
}

type UserAssignmentKind = 'assign' | 'unassign' | null;

function RoleUsersCard({ roleId }: { roleId: string }): ReactElement {
  const { showToast } = useToast();
  const checks = usePermissions();
  const canPickUsers = checks.has(PERMISSIONS.users.view);
  const [dialogKind, setDialogKind] = useState<UserAssignmentKind>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [manualId, setManualId] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = () => {
    setDialogKind(null);
    setSelectedUserId('');
    setManualId('');
    setFieldError(null);
    setActionError(null);
  };

  const run = (kind: 'assign' | 'unassign', userId: string) => {
    setPending(true);
    setActionError(null);
    const request =
      kind === 'assign'
        ? assignUserToRole(roleId, userId)
        : removeUserFromRole(roleId, userId);
    request
      .then(() => {
        setPending(false);
        close();
        showToast({
          kind: 'success',
          message: administrationSuccessMessage(
            'role',
            kind === 'assign' ? 'assignUser' : 'removeUser',
          ),
        });
      })
      .catch((error: unknown) => {
        setPending(false);
        const normalized = normalizeApiError(error);
        if (normalized.isUnauthorized) return;
        setActionError(
          administrationErrorMessage(
            'role',
            kind === 'assign' ? 'assignUser' : 'removeUser',
            error,
          ).message,
        );
      });
  };

  const confirm = (kind: 'assign' | 'unassign') => {
    const userId =
      manualId.trim() !== '' ? manualId.trim().toUpperCase() : selectedUserId;
    if (userId === '') {
      setFieldError(t.rolesAdmin.userIdRequired);
      return;
    }
    if (!ULID_PATTERN.test(userId)) {
      setFieldError(t.rolesAdmin.userIdInvalid);
      return;
    }
    setFieldError(null);
    run(kind, userId);
  };

  const assigning = dialogKind === 'assign';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.rolesAdmin.roleUsersSection}</CardTitle>
        <CardDescription>{t.rolesAdmin.roleUsersSectionHint}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <PermissionGate permission={PERMISSIONS.rbac.userRoleAssign}>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setActionError(null);
                setDialogKind('assign');
              }}
            >
              {t.rolesAdmin.assignUser}
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.rbac.userRoleRemove}>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setActionError(null);
                setDialogKind('unassign');
              }}
            >
              {t.rolesAdmin.unassignUser}
            </Button>
          </PermissionGate>
        </div>

        <ConfirmDialog
          open={dialogKind !== null}
          title={
            assigning
              ? t.rolesAdmin.assignUserTitle
              : t.rolesAdmin.unassignUserTitle
          }
          description={
            assigning
              ? t.rolesAdmin.assignUserBody
              : t.rolesAdmin.unassignUserBody
          }
          confirmLabel={
            assigning
              ? t.rolesAdmin.assignUserConfirm
              : t.rolesAdmin.unassignUser
          }
          loadingLabel={
            assigning
              ? t.rolesAdmin.assigningUser
              : t.rolesAdmin.unassigningUser
          }
          loading={pending}
          danger={!assigning}
          error={actionError}
          onConfirm={() => confirm(assigning ? 'assign' : 'unassign')}
          onCancel={close}
        >
          <div className="space-y-3">
            <UserSelectionFields
              mode={canPickUsers ? 'select' : 'manual'}
              userId={selectedUserId}
              manualId={manualId}
              disabled={pending}
              onUserIdChange={setSelectedUserId}
              onManualChange={setManualId}
            />
            {fieldError !== null && (
              <p role="alert" className="text-xs text-danger-ink">
                {fieldError}
              </p>
            )}
          </div>
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}
