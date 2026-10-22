import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { normalizeApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { Definition, DefinitionList } from '../administration-ui';
import {
  administrationErrorMessage,
  administrationSuccessMessage,
} from '../administration-error-messages';
import {
  useResetUserPasswordMutation,
  useUserDetail,
  useUserLifecycleMutation,
} from './user-hooks';

type ConfirmKind = 'enable' | 'disable' | null;

/**
 * User detail (`GET /users/:id`) with the account's own operations.
 *
 * Every action lives beside the field it changes: enable/disable on the
 * account state, the administrator password reset in its own section. There
 * is no delete — the backend registers no `Users.User.Delete` and the UI
 * never pretends otherwise.
 */
export function UserDetailPage(): ReactElement {
  const { userId } = useParams<{ userId: string }>();
  const query = useUserDetail(userId);

  if (query.isPending) {
    return <LoadingState rows={6} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.usersAdmin.userDetail} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.usersAdmin.userLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const user = query.data;
  const editTo = `/app/admin/users/${encodeURIComponent(user.id)}/edit`;

  return (
    <div className="space-y-4" data-testid="user-detail-page">
      <PageHeader
        title={t.usersAdmin.userDetail}
        description={t.usersAdmin.subtitle}
        actions={
          <PermissionGate permission={PERMISSIONS.users.edit}>
            <Button asChild size="sm" variant="outline">
              <Link to={editTo}>{t.usersAdmin.edit}</Link>
            </Button>
          </PermissionGate>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <span dir="ltr" className="code">
              {user.username}
            </span>
          </CardTitle>
          <CardDescription>{t.usersAdmin.userIdentity}</CardDescription>
        </CardHeader>
        <CardContent>
          <DefinitionList>
            <Definition label={t.usersAdmin.username}>
              <span dir="ltr" className="code font-medium">
                {user.username}
              </span>
            </Definition>
            <Definition label={t.usersAdmin.accountState}>
              {user.isActive === true ? (
                <Badge variant="success">{t.usersAdmin.active}</Badge>
              ) : (
                <Badge variant="neutral">{t.usersAdmin.inactive}</Badge>
              )}
            </Definition>
            <Definition label={t.usersAdmin.mustChangePassword}>
              {user.mustChangePassword === true ? (
                <Badge variant="warning">
                  {t.usersAdmin.mustChangePasswordYes}
                </Badge>
              ) : (
                <span className="text-slate-400">
                  {t.usersAdmin.mustChangePasswordNo}
                </span>
              )}
            </Definition>
            <Definition label={t.usersAdmin.createdAt}>
              <span className="num">{formatDateTime(user.createdAt)}</span>
            </Definition>
            <Definition label={t.usersAdmin.updatedAt}>
              <span className="num">{formatDateTime(user.updatedAt)}</span>
            </Definition>
          </DefinitionList>
        </CardContent>
      </Card>

      <AccountStateCard userId={user.id} isActive={user.isActive} />
      <PasswordResetCard userId={user.id} />
    </div>
  );
}

function AccountStateCard({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}): ReactElement {
  const { showToast } = useToast();
  const lifecycle = useUserLifecycleMutation();
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // On failure the dialog STAYS OPEN and the mapped message renders inside
  // the dialog (ConfirmDialog contract, FE-UX-02 §5).
  const run = (action: 'enable' | 'disable') => {
    setActionError(null);
    lifecycle.mutate(
      { userId, action },
      {
        onSuccess: () => {
          setConfirm(null);
          showToast({
            kind: 'success',
            message: administrationSuccessMessage('user', action),
          });
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setActionError(
            administrationErrorMessage('user', action, error).message,
          );
        },
      },
    );
  };

  const enabling = confirm === 'enable';
  const pending = lifecycle.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.usersAdmin.accountActions}</CardTitle>
        <CardDescription>
          {isActive ? t.usersAdmin.disableBody : t.usersAdmin.enableBody}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <PermissionGate permission={PERMISSIONS.users.enable}>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || isActive}
              onClick={() => {
                setActionError(null);
                setConfirm('enable');
              }}
            >
              {t.usersAdmin.enable}
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.users.disable}>
            <Button
              size="sm"
              variant="danger"
              disabled={pending || !isActive}
              onClick={() => {
                setActionError(null);
                setConfirm('disable');
              }}
            >
              {t.usersAdmin.disable}
            </Button>
          </PermissionGate>
        </div>

        <ConfirmDialog
          open={confirm !== null}
          title={
            enabling ? t.usersAdmin.enableTitle : t.usersAdmin.disableTitle
          }
          description={
            enabling ? t.usersAdmin.enableBody : t.usersAdmin.disableBody
          }
          confirmLabel={enabling ? t.usersAdmin.enable : t.usersAdmin.disable}
          loadingLabel={
            enabling ? t.usersAdmin.enabling : t.usersAdmin.disabling
          }
          loading={pending}
          danger={!enabling}
          error={actionError}
          onConfirm={() => run(enabling ? 'enable' : 'disable')}
          onCancel={() => setConfirm(null)}
        />
      </CardContent>
    </Card>
  );
}

function PasswordResetCard({ userId }: { userId: string }): ReactElement {
  const { showToast } = useToast();
  const reset = useResetUserPasswordMutation();
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setNewPassword('');
    setFieldError(null);
    setActionError(null);
  };

  const submit = () => {
    if (newPassword === '') {
      setFieldError(t.usersAdmin.newPasswordRequired);
      return;
    }
    setFieldError(null);
    setActionError(null);
    reset.mutate(
      { userId, newPassword },
      {
        onSuccess: () => {
          close();
          showToast({
            kind: 'success',
            message: administrationSuccessMessage('user', 'resetPassword'),
          });
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setActionError(
            administrationErrorMessage('user', 'resetPassword', error).message,
          );
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.usersAdmin.resetPassword}</CardTitle>
        <CardDescription>{t.usersAdmin.resetPasswordBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <PermissionGate permission={PERMISSIONS.users.resetPassword}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setActionError(null);
              setOpen(true);
            }}
          >
            {t.usersAdmin.resetPassword}
          </Button>
        </PermissionGate>

        <ConfirmDialog
          open={open}
          title={t.usersAdmin.resetPasswordTitle}
          description={t.usersAdmin.resetPasswordBody}
          confirmLabel={t.usersAdmin.resetPassword}
          loadingLabel={t.usersAdmin.resetting}
          loading={reset.isPending}
          danger
          error={actionError}
          onConfirm={submit}
          onCancel={close}
        >
          <div className="space-y-1.5">
            <label
              htmlFor="reset-password-input"
              className="block text-sm font-medium text-slate-700"
            >
              {t.usersAdmin.newPassword}
            </label>
            <Input
              id="reset-password-input"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={newPassword}
              aria-invalid={fieldError !== null}
              disabled={reset.isPending}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            {fieldError !== null && (
              <p role="alert" className="text-xs text-rose-700">
                {fieldError}
              </p>
            )}
          </div>
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}
