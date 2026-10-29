import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Moon, Sun, Type, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { z } from 'zod';
import { updateUser } from '@/api/admin.api';
import { normalizeApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { useOrganization } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useWorkspaceWindowTitle } from '@/app/workspace/workspace-context';
import { ModuleTonesSection } from './module-tones-section';
import { FONT_SCALES } from '@/lib/appearance';
import { formatDateTimeWithZone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAppearance } from '@/lib/use-appearance';
import { cn } from '@/lib/utils';
import { Alert, AlertBody } from '@/ui/alert';
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
import { PasswordInput } from '@/ui/password-input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { useToast } from '@/ui/patterns/toast';
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from './change-password-schema';
import { useSession } from './use-session';

const usernameFormSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, t.usersAdmin.usernameRequired)
    .max(64, t.usersAdmin.usernameTooLong),
});

type UsernameFormValues = z.infer<typeof usernameFormSchema>;

interface ValidationIssueLike {
  field?: unknown;
  code?: unknown;
}

function mapPasswordIssue(
  field: 'currentPassword' | 'newPassword',
  code: unknown,
): string {
  if (field === 'currentPassword') {
    return code === 'invalidCurrentPassword'
      ? t.auth.currentPasswordInvalid
      : t.auth.currentPasswordRequired;
  }
  if (code === 'mustDifferFromCurrent') return t.auth.newPasswordMustDiffer;
  if (code === 'maxLength') return t.auth.newPasswordMaxLength;
  return t.auth.newPasswordMinLength;
}

function applyPasswordServerIssues(
  error: unknown,
  setError: UseFormSetError<ChangePasswordFormValues>,
): string | undefined {
  const apiError = normalizeApiError(error);
  if (
    apiError.code !== 'ValidationFailed' ||
    !Array.isArray(apiError.details)
  ) {
    return apiError.isUnauthorized ? t.auth.sessionExpired : undefined;
  }
  let summary: string | undefined;
  for (const rawIssue of apiError.details) {
    if (typeof rawIssue !== 'object' || rawIssue === null) continue;
    const issue = rawIssue as ValidationIssueLike;
    if (issue.field === 'currentPassword' || issue.field === 'newPassword') {
      const message = mapPasswordIssue(issue.field, issue.code);
      setError(issue.field, { type: 'server', message });
      if (summary === undefined) summary = message;
    }
  }
  return summary ?? t.errors.validation;
}

/**
 * Authenticated User Profile & Software Settings (`/app/profile`).
 *
 * Connects exclusively to real backend endpoints:
 * - `GET /api/v1/auth/me` (session user facts)
 * - `PATCH /api/v1/users/:id` when holding `Users.User.Edit` (username update)
 * - `POST /api/v1/auth/change-password` (self-service password change)
 * - `POST /api/v1/auth/logout` (idempotent session revocation)
 * Plus browser-persisted theme & 3-level font scale (`vardena:appearance:v1`).
 */
export function ProfilePage() {
  // Window-tab title override (§6.6): «حساب کاربری» instead of the derived
  // path-based fallback.
  useWorkspaceWindowTitle(t.app.profile);
  const session = useSession();
  const permissions = usePermissions();
  const { organization } = useOrganization();
  const appearance = useAppearance();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [usernameError, setUsernameError] = useState<unknown>(null);

  const user = session.user;
  const canEditUsername =
    permissions.loaded && permissions.has(PERMISSIONS.users.edit);

  const usernameForm = useForm<UsernameFormValues>({
    resolver: zodResolver(usernameFormSchema),
    defaultValues: { username: user?.username ?? '' },
    mode: 'onSubmit',
  });

  useEffect(() => {
    if (user !== null) {
      usernameForm.reset({ username: user.username });
    }
  }, [user, usernameForm]);

  const usernameMutation = useMutation({
    mutationFn: (values: UsernameFormValues) =>
      updateUser(user?.id ?? '', { username: values.username.trim() }),
    onSuccess: async (updated) => {
      setUsernameError(null);
      if (user !== null) {
        queryClient.setQueryData(queryKeys.session(), {
          ...user,
          username: updated.username,
          updatedAt: updated.updatedAt,
        });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
      showToast({ kind: 'success', message: t.profile.usernameUpdated });
    },
    onError: (err) => {
      setUsernameError(err);
    },
  });

  const passwordForm = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
    mode: 'onSubmit',
  });

  const onPasswordSubmit = passwordForm.handleSubmit(async (values) => {
    session.resetChangePasswordError();
    try {
      await session.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      passwordForm.reset({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      showToast({ kind: 'success', message: t.profile.passwordChangedSuccess });
    } catch (caught) {
      passwordForm.setValue('currentPassword', '');
      passwordForm.setValue('newPassword', '');
      passwordForm.setValue('confirmPassword', '');
      applyPasswordServerIssues(caught, passwordForm.setError);
    }
  });

  if (user === null) return null;

  const isPasswordBusy = session.isChangingPassword || session.isLoggingOut;
  const passwordServerError = session.changePasswordError;

  return (
    <div className="space-y-4" data-testid="profile-page">
      <PageHeader title={t.profile.title} description={t.profile.subtitle} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Account Information & Username */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand">
                <UserRound className="h-4 w-4" aria-hidden />
              </span>
              {t.profile.accountSection}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DefinitionList>
              <Definition label={t.profile.usernameLabel}>
                <span className="code font-semibold">{user.username}</span>
              </Definition>
              <Definition label={t.profile.userIdLabel}>
                <span className="code text-xs">{user.id}</span>
              </Definition>
              <Definition label={t.profile.statusLabel}>
                <Badge variant={user.isActive ? 'success' : 'neutral'}>
                  {user.isActive ? t.usersAdmin.active : t.usersAdmin.inactive}
                </Badge>
              </Definition>
              <Definition label={t.profile.activeOrganizationLabel}>
                {organization !== null ? organization.name : t.app.none}
              </Definition>
              <Definition label={t.usersAdmin.createdAt}>
                <span className="code" title={user.createdAt}>
                  {formatDateTimeWithZone(user.createdAt)}
                </span>
              </Definition>
              <Definition label={t.usersAdmin.updatedAt}>
                <span className="code" title={user.updatedAt}>
                  {formatDateTimeWithZone(user.updatedAt)}
                </span>
              </Definition>
            </DefinitionList>

            {canEditUsername ? (
              <form
                noValidate
                className="space-y-3 border-t border-line pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void usernameForm.handleSubmit((vals) =>
                    usernameMutation.mutate(vals),
                  )(event);
                }}
              >
                <FormField
                  id="profile-username"
                  label={t.profile.usernameLabel}
                  required
                  error={usernameForm.formState.errors.username?.message}
                  hint={t.usersAdmin.usernameHint}
                >
                  {(fieldProps) => (
                    <Input
                      {...fieldProps}
                      dir="ltr"
                      disabled={usernameMutation.isPending}
                      {...usernameForm.register('username')}
                    />
                  )}
                </FormField>

                {usernameError !== null && (
                  <ApiErrorAlert
                    error={usernameError}
                    title={t.usersAdmin.updateFailed}
                    {...(normalizeApiError(usernameError).status === 409
                      ? { description: t.usersAdmin.duplicateUsername }
                      : {})}
                  />
                )}

                <Button
                  type="submit"
                  size="sm"
                  disabled={usernameMutation.isPending}
                  loading={usernameMutation.isPending}
                  data-testid="profile-save-username"
                >
                  {usernameMutation.isPending
                    ? t.profile.savingUsername
                    : t.profile.saveUsername}
                </Button>
              </form>
            ) : (
              <p className="border-t border-line pt-3 text-xs text-ink-subtle">
                {t.profile.usernameReadOnlyHint}
              </p>
            )}

            <Alert variant="neutral">
              <AlertBody>{t.profile.avatarBackendNote}</AlertBody>
            </Alert>
          </CardContent>
        </Card>

        {/* Self-Service Password Change */}
        <Card>
          <CardHeader>
            <CardTitle>{t.profile.passwordSection}</CardTitle>
            <CardDescription>
              {t.profile.passwordSectionSubtitle}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void onPasswordSubmit(event);
              }}
            >
              <FormField
                id="profile-current-password"
                label={t.auth.currentPassword}
                required
                error={passwordForm.formState.errors.currentPassword?.message}
              >
                {(fieldProps) => (
                  <PasswordInput
                    {...fieldProps}
                    autoComplete="current-password"
                    dir="ltr"
                    disabled={isPasswordBusy}
                    {...passwordForm.register('currentPassword')}
                  />
                )}
              </FormField>

              <FormField
                id="profile-new-password"
                label={t.auth.newPassword}
                required
                hint={t.auth.passwordLengthHint}
                error={passwordForm.formState.errors.newPassword?.message}
              >
                {(fieldProps) => (
                  <PasswordInput
                    {...fieldProps}
                    autoComplete="new-password"
                    dir="ltr"
                    disabled={isPasswordBusy}
                    {...passwordForm.register('newPassword')}
                  />
                )}
              </FormField>

              <FormField
                id="profile-confirm-password"
                label={t.auth.confirmPassword}
                required
                error={passwordForm.formState.errors.confirmPassword?.message}
              >
                {(fieldProps) => (
                  <PasswordInput
                    {...fieldProps}
                    autoComplete="new-password"
                    dir="ltr"
                    disabled={isPasswordBusy}
                    {...passwordForm.register('confirmPassword')}
                  />
                )}
              </FormField>

              {passwordServerError !== null &&
                passwordServerError !== undefined && (
                  <ApiErrorAlert
                    error={passwordServerError}
                    title={t.auth.changePasswordFailedTitle}
                  />
                )}

              <Button
                type="submit"
                disabled={isPasswordBusy}
                loading={session.isChangingPassword}
                data-testid="profile-change-password-submit"
              >
                {session.isChangingPassword
                  ? t.auth.changingPassword
                  : t.auth.submitChangePassword}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Appearance Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t.profile.appearanceSection}</CardTitle>
            <CardDescription>{t.profile.appearanceSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-ink-muted">
                {t.app.themeLabel}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={appearance.theme === 'light'}
                  onClick={() => appearance.setTheme('light')}
                  data-testid="profile-theme-light"
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-control border px-3 py-2 text-xs font-medium transition-colors',
                    appearance.theme === 'light'
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                  )}
                >
                  <Sun className="h-4 w-4" aria-hidden />
                  {t.app.themeLight}
                </button>
                <button
                  type="button"
                  aria-pressed={appearance.theme === 'dark'}
                  onClick={() => appearance.setTheme('dark')}
                  data-testid="profile-theme-dark"
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-control border px-3 py-2 text-xs font-medium transition-colors',
                    appearance.theme === 'dark'
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                  )}
                >
                  <Moon className="h-4 w-4" aria-hidden />
                  {t.app.themeDark}
                </button>
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-ink-muted">
                <Type className="h-3.5 w-3.5" aria-hidden />
                {t.app.fontScaleLabel}
              </p>
              <div className="flex gap-2">
                {FONT_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    aria-pressed={appearance.fontScale === scale}
                    onClick={() => appearance.setFontScale(scale)}
                    data-testid={`profile-font-scale-${scale}`}
                    className={cn(
                      'flex-1 rounded-control border px-3 py-2 text-xs font-medium transition-colors',
                      appearance.fontScale === scale
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                    )}
                  >
                    {t.app.fontScaleOptions[scale]}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Module tone assignment (D-3, ADR-0054 §4.3) */}
        <ModuleTonesSection />

        {/* Session & Secure Logout */}
        <Card>
          <CardHeader>
            <CardTitle>{t.profile.sessionSection}</CardTitle>
            <CardDescription>{t.profile.sessionSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="danger"
              disabled={session.isLoggingOut}
              loading={session.isLoggingOut}
              onClick={() => {
                void session.logout();
              }}
              data-testid="profile-logout-button"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
