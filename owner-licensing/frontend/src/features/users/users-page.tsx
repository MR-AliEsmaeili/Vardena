import { LocalFetchingIndicator } from '@/ui/patterns/request-activity';
import { Select } from '@/ui/select';
import { PageHeading } from '@/ui/patterns/page-heading';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as api from '@/api/owner.api';
import type { AuthenticatedUser } from '@/api/contracts';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PasswordInput } from '@/ui/password-input';
import { FormField } from '@/ui/patterns/form-field';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination, useDirtyGuard } from '@/ui/patterns/owner-states';

const roleSchema = z.enum(['OWNER_ADMIN', 'LICENSE_OPERATOR']);
const createSchema = z.object({
  username: z.string().trim().min(1, o.required).max(64),
  password: z
    .string()
    .min(8, o.passwordRule)
    .max(128)
    .refine((v) => !!v.trim(), o.passwordRule),
  role: roleSchema,
});
const accessSchema = z.object({
  role: roleSchema,
  isActive: z.boolean(),
  reason: z.string().trim().min(1, o.required).max(500),
});
const resetSchema = z.object({
  password: createSchema.shape.password,
  reason: accessSchema.shape.reason,
});

export function UsersPage() {
  const permissions = usePermissions(),
    [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [selected, setSelected] = useState<AuthenticatedUser | null>(null);
  const query = useQuery({
    queryKey: ['owner', 'users', page],
    queryFn: () => api.users(page),
    enabled: permissions.has('users.manage'),
  });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('users.manage'))
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  return (
    <section className="space-y-5">
      <PageHeading>{o.users}</PageHeading>
      <CreateUser />
      <LocalFetchingIndicator active={query.isFetching && !query.isPending} />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y owner-panel overflow-hidden">
          {query.data.items.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink">
                  {u.username} — {o.roles[u.role]}
                </span>
                <Badge variant={u.isActive ? 'success' : 'neutral'}>
                  {u.isActive ? o.active : o.inactive}
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(u)}
              >
                {o.editAccess}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        count={query.data?.items.length ?? 0}
        setPage={(p) => setParams({ page: String(p) })}
      />
      {selected && (
        <section key={selected.id} className="space-y-4 owner-panel p-5">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <h2 className="text-base font-bold text-ink" dir="ltr">
              {selected.username}
            </h2>
            <Badge variant={selected.isActive ? 'success' : 'neutral'}>
              {selected.isActive ? o.active : o.inactive}
            </Badge>
          </div>
          <AccessForm user={selected} onDone={() => setSelected(null)} />
          <ResetForm user={selected} />
        </section>
      )}
    </section>
  );
}
function RoleSelect({ register }: { register: UseFormRegisterReturn<'role'> }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-ink">
      <span>{o.role}</span>
      <Select {...register}>
        {Object.entries(o.roles).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </label>
  );
}
function CreateUser() {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { username: '', password: '', role: 'LICENSE_OPERATOR' },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: async () => {
      form.reset();
      await qc.invalidateQueries({ queryKey: ['owner', 'users'] });
    },
    onError: () => form.resetField('password'),
  });
  return (
    <form
      className="max-w-xl space-y-3.5 owner-panel p-5"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h2 className="text-base font-semibold text-ink">{o.createUser}</h2>
      <FormField
        id="new-username"
        label={o.username}
        error={form.formState.errors.username?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...form.register('username')}
            type="text"
            autoComplete="off"
            aria-required
            dir="ltr"
          />
        )}
      </FormField>
      <FormField
        id="new-password"
        label={o.password}
        error={form.formState.errors.password?.message}
      >
        {(props) => (
          <PasswordInput
            {...props}
            {...form.register('password')}
            autoComplete="new-password"
            aria-required
            dir="ltr"
          />
        )}
      </FormField>
      <RoleSelect register={form.register('role')} />
      <p className="text-xs text-muted-ink">{o.mustChange}</p>
      {mutation.isError && <ApiErrorAlert error={mutation.error} />}
      {mutation.isSuccess && (
        <output className="owner-success">{o.success}</output>
      )}
      <Button loading={mutation.isPending} disabled={mutation.isPending}>
        {mutation.isPending ? o.saving : o.createUser}
      </Button>
    </form>
  );
}
function AccessForm({
  user,
  onDone,
}: {
  user: AuthenticatedUser;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof accessSchema>>({
    resolver: zodResolver(accessSchema),
    defaultValues: { role: user.role, isActive: user.isActive, reason: '' },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof accessSchema>) => api.updateUser(user.id, v),
    onSuccess: async () => {
      form.reset();
      await qc.invalidateQueries({ queryKey: ['owner', 'users'] });
      await qc.invalidateQueries({ queryKey: ['owner', 'session'] });
      await qc.invalidateQueries({ queryKey: ['owner', 'permissions'] });
      onDone();
    },
  });
  return (
    <form
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      className="max-w-xl space-y-3"
    >
      <label className="block space-y-1.5 text-sm font-medium text-ink">
        <span>{o.role}</span>
        <Select {...form.register('role')}>
          {Object.entries(o.roles).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" {...form.register('isActive')} />
        {o.enabled}
      </label>
      <FormField
        id="access-reason"
        label={o.reason}
        error={form.formState.errors.reason?.message}
      >
        {(props) => (
          <Input {...props} {...form.register('reason')} aria-required />
        )}
      </FormField>
      {mutation.isError && <ApiErrorAlert error={mutation.error} />}
      <Button loading={mutation.isPending} disabled={mutation.isPending}>
        {mutation.isPending ? o.saving : o.save}
      </Button>
    </form>
  );
}
function ResetForm({ user }: { user: AuthenticatedUser }) {
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', reason: '' },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof resetSchema>) =>
      api.resetPassword(user.id, v),
    onSuccess: () => form.reset(),
    onError: () => form.resetField('password'),
  });
  return (
    <form
      className="max-w-xl space-y-3 border-t border-line pt-4"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h3 className="text-sm font-semibold text-ink">{o.resetPassword}</h3>
      <FormField
        id="reset-password"
        label={o.newPassword}
        error={form.formState.errors.password?.message}
      >
        {(props) => (
          <PasswordInput
            {...props}
            {...form.register('password')}
            autoComplete="new-password"
            aria-required
            dir="ltr"
          />
        )}
      </FormField>
      <FormField
        id="reset-reason"
        label={o.reason}
        error={form.formState.errors.reason?.message}
      >
        {(props) => (
          <Input {...props} {...form.register('reason')} aria-required />
        )}
      </FormField>
      {mutation.isError && <ApiErrorAlert error={mutation.error} />}
      {mutation.isSuccess && (
        <output className="owner-success">{o.success}</output>
      )}
      <Button loading={mutation.isPending} disabled={mutation.isPending}>
        {mutation.isPending ? o.saving : o.resetPassword}
      </Button>
    </form>
  );
}
