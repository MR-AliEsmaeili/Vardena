import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { OrganizationMembership } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { listUsers } from '@/api/admin.api';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { useSession } from '@/features/auth/use-session';
import { usePermissions } from '@/features/permissions/use-permissions';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '@/lib/use-admin-list-state';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  useGrantMembershipMutation,
  useOrganizationMembersList,
  useRevokeMembershipMutation,
} from './member-hooks';

/** Mirror of `class-validator`'s `@IsUlid` (Crockford base32, 26 chars). */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const MEMBER_SORT_FIELDS = ['createdAt'] as const;
const MEMBER_DEFAULT_SORT = 'createdAt:desc';

/**
 * Organization members (`GET /organizations/:id/members`) with grant/revoke.
 *
 * The rows identify users by ULID only; the USERNAME column renders only
 * with `Users.User.View` (the id otherwise — the page says so instead of
 * showing a broken column). Revoking YOUR OWN membership warns explicitly
 * before acting: after it, this very session loses this organization.
 */
export function MembersPage(): ReactElement {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: MEMBER_SORT_FIELDS,
    defaultSort: MEMBER_DEFAULT_SORT,
  });
  const query = useOrganizationMembersList(organizationId, list.state);
  const rows = useMemo(() => query.data?.items ?? [], [query.data]);
  const usernameById = useMemberUsernameMap(rows);
  const checks = usePermissions();

  if (organizationId === null) {
    return <LoadingState rows={5} label={t.app.loading} />;
  }

  return (
    <div className="space-y-4" data-testid="members-page">
      <PageHeader
        title={t.orgAdmin.members}
        description={t.orgAdmin.membersDescription}
        actions={
          <PermissionGate permission={PERMISSIONS.organization.membershipGrant}>
            <GrantMemberButton organizationId={organizationId} />
          </PermissionGate>
        }
      />

      <MembersTable
        rows={rows}
        usernameById={usernameById}
        canRevoke={checks.has(PERMISSIONS.organization.membershipRevoke)}
        organizationId={organizationId}
        page={query.data?.page ?? list.state.page}
        pageSize={query.data?.pageSize ?? list.state.pageSize}
        total={query.data?.total ?? 0}
        sorting={list.state.sorting}
        onSortingChange={list.setSorting}
        onPageChange={(page) => list.update({ page })}
        onPageSizeChange={(pageSize) => list.update({ pageSize })}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Username resolution (Users.User.View — optional convenience)
// ---------------------------------------------------------------------------

/**
 * Usernames for the member rows, resolved through the bounded user list
 * read. Returns `null` without `Users.User.View` — the caller then renders
 * the raw ULID and labels it as such.
 */
function useMemberUsernameMap(
  rows: OrganizationMembership[],
): Map<string, string> | null {
  const checks = usePermissions();
  const canSeeUsers = checks.has(PERMISSIONS.users.view);
  const hasRows = rows.length > 0;

  const users = useQuery({
    queryKey: queryKeys.users.list({ reference: 'member-names' }),
    queryFn: ({ signal }) =>
      listUsers({ page: 1, pageSize: 200, sort: 'username:asc' }, signal),
    enabled: canSeeUsers && hasRows,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    if (!canSeeUsers) return null;
    const map = new Map<string, string>();
    for (const user of users.data?.items ?? []) {
      map.set(user.id, user.username);
    }
    return map;
  }, [canSeeUsers, users.data]);
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

interface MembersTableProps {
  rows: OrganizationMembership[];
  usernameById: Map<string, string> | null;
  canRevoke: boolean;
  organizationId: string;
  page: number;
  pageSize: number;
  total: number;
  sorting: ReturnType<typeof useAdminListState>['state']['sorting'];
  onSortingChange: ReturnType<typeof useAdminListState>['setSorting'];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}

function MembersTable({
  rows,
  usernameById,
  canRevoke,
  organizationId,
  page,
  pageSize,
  total,
  sorting,
  onSortingChange,
  onPageChange,
  onPageSizeChange,
  isLoading,
  isFetching,
  error,
  onRetry,
}: MembersTableProps): ReactElement {
  const columns = useMemo(
    () => memberColumns({ usernameById, canRevoke, organizationId }),
    [usernameById, canRevoke, organizationId],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.userId}
      caption={t.orgAdmin.memberList}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      errorDescription={t.orgAdmin.membersLoadFailed}
      onRetry={onRetry}
      emptyTitle={t.orgAdmin.members}
      emptyDescription={t.orgAdmin.noMembers}
      sorting={sorting}
      onSortingChange={onSortingChange}
      pagination={{
        page,
        pageSize,
        total,
        pageSizeOptions: [...ADMIN_PAGE_SIZE_OPTIONS],
        onPageChange,
        onPageSizeChange,
      }}
    />
  );
}

interface MemberColumnHandlers {
  usernameById: Map<string, string> | null;
  canRevoke: boolean;
  organizationId: string;
}

function memberColumns({
  usernameById,
  canRevoke,
  organizationId,
}: MemberColumnHandlers): ColumnDef<OrganizationMembership, unknown>[] {
  return [
    {
      accessorKey: 'userId',
      header: t.orgAdmin.memberUser,
      cell: ({ row }) => {
        const username = usernameById?.get(row.original.userId);
        return username !== undefined ? (
          <span className="font-medium text-slate-900" dir="ltr">
            {username}
          </span>
        ) : (
          <span
            className="code text-xs text-slate-500"
            title={t.orgAdmin.membersUserUnavailable}
            dir="ltr"
          >
            {row.original.userId}
          </span>
        );
      },
    },
    {
      accessorKey: 'createdAt',
      header: t.orgAdmin.memberSince,
      cell: ({ row }) => (
        <span className="num">{formatDateTime(row.original.createdAt)}</span>
      ),
    },
    {
      id: 'actions',
      header: t.orgAdmin.actions,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) =>
        canRevoke ? (
          <PermissionGate
            permission={PERMISSIONS.organization.membershipRevoke}
          >
            <RevokeMemberButton
              organizationId={organizationId}
              userId={row.original.userId}
              username={usernameById?.get(row.original.userId) ?? null}
            />
          </PermissionGate>
        ) : null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Grant
// ---------------------------------------------------------------------------

function GrantMemberButton({
  organizationId,
}: {
  organizationId: string;
}): ReactElement {
  const { showToast } = useToast();
  const grant = useGrantMembershipMutation(organizationId);
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [manualId, setManualId] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const checks = usePermissions();
  const canPickUsers = checks.has(PERMISSIONS.users.view);

  const close = () => {
    setOpen(false);
    setSelectedUserId('');
    setManualId('');
    setFieldError(null);
    setActionError(null);
  };

  const submit = () => {
    const userId =
      manualId.trim() !== '' ? manualId.trim().toUpperCase() : selectedUserId;
    if (userId === '') {
      setFieldError(t.orgAdmin.grantUserRequired);
      return;
    }
    if (!ULID_PATTERN.test(userId)) {
      setFieldError(t.orgAdmin.userIdInvalid);
      return;
    }
    setFieldError(null);
    setActionError(null);
    grant.mutate(
      { userId },
      {
        onSuccess: () => {
          close();
          showToast({ kind: 'success', message: t.orgAdmin.memberGranted });
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setActionError(membershipErrorMessage('grant', error));
        },
      },
    );
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setActionError(null);
          setOpen(true);
        }}
      >
        {t.orgAdmin.grantMember}
      </Button>

      <ConfirmDialog
        open={open}
        title={t.orgAdmin.grantMemberTitle}
        description={t.orgAdmin.grantMemberBody}
        confirmLabel={t.orgAdmin.grantMemberConfirm}
        loadingLabel={t.orgAdmin.grantingMember}
        loading={grant.isPending}
        error={actionError}
        onConfirm={submit}
        onCancel={close}
      >
        <MemberUserSelection
          mode={canPickUsers ? 'select' : 'manual'}
          userId={selectedUserId}
          manualId={manualId}
          disabled={grant.isPending}
          onUserIdChange={setSelectedUserId}
          onManualChange={setManualId}
        />
        {fieldError !== null && (
          <p role="alert" className="mt-2 text-xs text-rose-700">
            {fieldError}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

function RevokeMemberButton({
  organizationId,
  userId,
  username,
}: {
  organizationId: string;
  userId: string;
  username: string | null;
}): ReactElement {
  const { showToast } = useToast();
  const revoke = useRevokeMembershipMutation(organizationId);
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The backend ALLOWS revoking one's own membership; the UI warns first
  // because this very session loses the organization afterwards.
  const session = useSession();
  const isSelf = session.user?.id === userId;

  const close = () => {
    setOpen(false);
    setActionError(null);
  };

  const submit = () => {
    setActionError(null);
    revoke.mutate(
      { userId },
      {
        onSuccess: () => {
          close();
          showToast({ kind: 'success', message: t.orgAdmin.memberRevoked });
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setActionError(membershipErrorMessage('revoke', error));
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={revoke.isPending}
        onClick={() => {
          setActionError(null);
          setOpen(true);
        }}
      >
        {t.orgAdmin.revokeMember}
      </Button>

      <ConfirmDialog
        open={open}
        title={t.orgAdmin.revokeMemberTitle}
        description={t.orgAdmin.revokeMemberBody}
        confirmLabel={t.orgAdmin.revokeMemberConfirm}
        loadingLabel={t.orgAdmin.revokingMember}
        loading={revoke.isPending}
        danger
        error={actionError}
        onConfirm={submit}
        onCancel={close}
      >
        {username !== null && (
          <p className="text-sm text-slate-700">
            {t.orgAdmin.memberUser}:{' '}
            <span dir="ltr" className="font-medium">
              {username}
            </span>
          </p>
        )}
        {isSelf && (
          <p
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
          >
            {t.orgAdmin.revokeSelfWarning}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

/** Operation-scoped Persian failure for the membership mutations. */
function membershipErrorMessage(
  operation: 'grant' | 'revoke',
  error: unknown,
): string {
  const apiError = normalizeApiError(error);
  switch (apiError.code) {
    case 'PermissionDenied':
      return t.errors.forbidden;
    case 'EntityNotFound':
      return t.orgAdmin.userMissing;
    case 'Conflict':
      return t.orgAdmin.alreadyMember;
    default:
      return operation === 'grant'
        ? t.orgAdmin.grantFailed
        : t.orgAdmin.revokeFailed;
  }
}

// ---------------------------------------------------------------------------
// Shared user selection (picker gated on Users.User.View; ULID fallback)
// ---------------------------------------------------------------------------

function MemberUserSelection({
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
    queryKey: queryKeys.users.list({ reference: 'member-picker' }),
    queryFn: ({ signal }) =>
      listUsers({ page: 1, pageSize: 200, sort: 'username:asc' }, signal),
    enabled: mode === 'select',
    staleTime: 5 * 60 * 1000,
  });

  // A failed registry read degrades to manual ULID entry instead of a dead
  // select — the picker is a convenience, never a hard dependency.
  if (mode === 'select' && !users.isError) {
    const items = users.data?.items ?? [];
    return (
      <div className="space-y-1.5">
        <label
          htmlFor="member-user-select"
          className="block text-sm font-medium text-slate-700"
        >
          {t.orgAdmin.memberUser}
        </label>
        <Select
          id="member-user-select"
          value={userId}
          disabled={disabled || users.isPending}
          onChange={(event) => onUserIdChange(event.target.value)}
        >
          <option value="">{t.orgAdmin.grantUserRequired}</option>
          {items.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username}
              {user.isActive ? '' : ` (${t.usersAdmin.inactive})`}
            </option>
          ))}
        </Select>
        {users.isPending && (
          <p className="text-xs text-slate-500">{t.app.loading}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="member-user-manual"
        className="block text-sm font-medium text-slate-700"
      >
        {t.orgAdmin.grantPickerUnavailable}
      </label>
      <Input
        id="member-user-manual"
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
