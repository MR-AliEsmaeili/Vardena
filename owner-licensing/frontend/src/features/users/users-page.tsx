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
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
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
  if (!permissions.has('users.manage')) return <p>{o.forbidden}</p>;
  return (
    <section className="space-y-5">
      <h1 className="text-xl font-bold">{o.users}</h1>
      <CreateUser />
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
        <ul className="divide-y rounded border bg-white">
          {query.data.items.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <span>
                {u.username} — {o.roles[u.role]} (
                {u.isActive ? o.active : o.inactive})
              </span>
              <Button variant="outline" onClick={() => setSelected(u)}>
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
        <section
          key={selected.id}
          className="space-y-4 rounded border bg-white p-4"
        >
          <h2 className="font-bold">{selected.username}</h2>
          <AccessForm user={selected} onDone={() => setSelected(null)} />
          <ResetForm user={selected} />
        </section>
      )}
    </section>
  );
}
function RoleSelect({ register }: { register: UseFormRegisterReturn<'role'> }) {
  return (
    <label className="block space-y-2">
      <span>{o.role}</span>
      <select className="w-full rounded border p-2" {...register}>
        {Object.entries(o.roles).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
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
      className="max-w-xl space-y-3 rounded border bg-white p-4"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h2 className="font-semibold">{o.createUser}</h2>
      {(['username', 'password'] as const).map((key) => (
        <FormField
          key={key}
          id={`new-${key}`}
          label={key === 'username' ? o.username : o.password}
          error={form.formState.errors[key]?.message}
        >
          {(props) => (
            <Input
              {...props}
              {...form.register(key)}
              type={key === 'password' ? 'password' : 'text'}
              autoComplete={key === 'password' ? 'new-password' : 'off'}
              aria-required
              dir="ltr"
            />
          )}
        </FormField>
      ))}
      <RoleSelect register={form.register('role')} />
      <p className="text-sm text-slate-500">{o.mustChange}</p>
      {mutation.isError && <ApiErrorAlert error={mutation.error} />}
      {mutation.isSuccess && <output>{o.success}</output>}
      <Button disabled={mutation.isPending}>
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
      <label className="block space-y-2">
        <span>{o.role}</span>
        <select
          className="w-full rounded border p-2"
          {...form.register('role')}
        >
          {Object.entries(o.roles).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex gap-2">
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
      <Button disabled={mutation.isPending}>
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
      className="max-w-xl space-y-3 border-t pt-4"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h3 className="font-semibold">{o.resetPassword}</h3>
      <FormField
        id="reset-password"
        label={o.newPassword}
        error={form.formState.errors.password?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...form.register('password')}
            type="password"
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
      {mutation.isSuccess && <output>{o.success}</output>}
      <Button disabled={mutation.isPending}>
        {mutation.isPending ? o.saving : o.resetPassword}
      </Button>
    </form>
  );
}
