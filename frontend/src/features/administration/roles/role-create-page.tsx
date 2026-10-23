import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { normalizeApiError } from '@/api/errors';
import type { AdminPermission } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { FormField } from '@/ui/patterns/form-field';
import { useToast } from '@/ui/patterns/toast';
import {
  administrationErrorMessage,
  administrationSuccessMessage,
} from '../administration-error-messages';
import { AdministrationFormShell } from '../administration-form-shell';
import { useCreateRoleMutation, usePermissionRegistry } from './role-hooks';
import { createRoleSchema, type CreateRoleFormValues } from './role-schemas';

/**
 * Create a role (`POST /roles`, `Rbac.Role.Create`).
 *
 * The initial permission set is OPTIONAL and lands in the same create
 * transaction; it can also be left empty and managed later from the role's
 * own page. The registry picker reads `GET /permissions` and therefore needs
 * `Rbac.Permission.View` in addition to the role-create permission — exactly
 * what the backend will demand of the request.
 */
export function RoleCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createMutation = useCreateRoleMutation();
  const [serverError, setServerError] = useState<ReturnType<
    typeof administrationErrorMessage
  > | null>(null);

  const form = useForm<CreateRoleFormValues>({
    resolver: zodResolver(createRoleSchema),
    mode: 'onSubmit',
    defaultValues: { name: '', description: '', permissionCodes: [] },
  });

  const submitting = createMutation.isPending;
  const watchedCodes = form.watch('permissionCodes');
  const selectedCount = Array.isArray(watchedCodes) ? watchedCodes.length : 0;

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);
    // Same-name native checkboxes normally produce an array; normalize the
    // degenerate single-checkbox shapes so the wire contract always holds.
    const permissionCodes = Array.isArray(values.permissionCodes)
      ? values.permissionCodes
      : [];
    createMutation.mutate(
      {
        name: values.name,
        description: values.description === '' ? null : values.description,
        ...(permissionCodes.length > 0 ? { permissionCodes } : {}),
      },
      {
        onSuccess: (created) => {
          showToast({
            kind: 'success',
            message: administrationSuccessMessage('role', 'create'),
          });
          navigate(`/app/admin/roles/${encodeURIComponent(created.id)}`);
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setServerError(administrationErrorMessage('role', 'create', error));
        },
      },
    );
  });

  return (
    <AdministrationFormShell
      title={t.rolesAdmin.newRole}
      description={t.rolesAdmin.newRoleDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.rolesAdmin.create}
      cancelTo="/app/admin/roles"
      onSubmit={onSubmit}
      testId="role-create-form"
    >
      <FormField
        id="role-name"
        label={t.rolesAdmin.roleName}
        error={form.formState.errors.name?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('name')}
          />
        )}
      </FormField>

      <FormField
        id="role-description"
        label={t.rolesAdmin.description}
        error={form.formState.errors.description?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            disabled={submitting}
            {...form.register('description')}
          />
        )}
      </FormField>

      <div className="sm:col-span-2">
        <InitialPermissionsPicker
          disabled={submitting}
          selectedCount={selectedCount}
          registration={form.register('permissionCodes')}
        />
      </div>
    </AdministrationFormShell>
  );
}

/**
 * The bounded permission-registry checkbox list with a client-side search
 * over the (already server-bounded) page. Hidden behind
 * `Rbac.Permission.View`; without it the picker degrades to an explanation
 * instead of a broken control (FE-UX-02 §4).
 */
function InitialPermissionsPicker({
  disabled,
  selectedCount,
  registration,
}: {
  disabled: boolean;
  selectedCount: number;
  registration: UseFormRegisterReturn<'permissionCodes'>;
}): ReactElement {
  const registry = usePermissionRegistry();
  const [search, setSearch] = useState('');

  const items = useMemo(() => registry.data?.items ?? [], [registry.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter(
      (permission: AdminPermission) =>
        permission.code.toLowerCase().includes(needle) ||
        permission.description.toLowerCase().includes(needle),
    );
  }, [items, search]);

  return (
    <section
      className="rounded-lg border border-line bg-surface p-4"
      aria-label={t.rolesAdmin.initialPermissions}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t.rolesAdmin.initialPermissions}
        </h3>
        <p className="text-xs text-ink-subtle">
          {t.rolesAdmin.selectedCount.replace(
            '{count}',
            formatCount(selectedCount),
          )}
        </p>
      </div>
      <p className="mt-1 text-xs text-ink-subtle">
        {t.rolesAdmin.initialPermissionsHint}
      </p>

      <PermissionGate permission={PERMISSIONS.rbac.permissionView}>
        <div className="mt-3 space-y-3">
          <Input
            type="search"
            value={search}
            placeholder={t.rolesAdmin.registrySearchPlaceholder}
            disabled={disabled || registry.isPending}
            onChange={(event) => setSearch(event.target.value)}
          />

          {registry.isPending && (
            <p className="text-xs text-ink-subtle">{t.app.loading}</p>
          )}
          {registry.isError && (
            <p role="alert" className="text-xs text-danger-ink">
              {t.rolesAdmin.registryLoadFailed}
            </p>
          )}

          {filtered.length > 0 && (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-line p-2">
              {filtered.map((permission) => (
                <label
                  key={permission.code}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-sunken"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-line-strong"
                    value={permission.code}
                    disabled={disabled}
                    {...registration}
                  />
                  <span className="min-w-0">
                    <span
                      className="code block text-xs font-medium text-ink"
                      dir="ltr"
                    >
                      {permission.code}
                    </span>
                    {permission.description !== '' && (
                      <span className="block text-xs text-ink-subtle">
                        {permission.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          {!registry.isPending &&
            !registry.isError &&
            filtered.length === 0 && (
              <p className="text-xs text-ink-subtle">
                {t.rolesAdmin.permissionsEmpty}
              </p>
            )}
        </div>
      </PermissionGate>
    </section>
  );
}
