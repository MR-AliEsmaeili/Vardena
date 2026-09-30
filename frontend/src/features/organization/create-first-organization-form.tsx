import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { createOrganization, grantMembership } from '@/api/organization.api';
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
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import {
  createFirstOrganizationSchema,
  type CreateFirstOrganizationFormValues,
} from './create-first-organization-schema';

/**
 * The unpinned-deployment first-organization step (task §4/§7).
 *
 * `GET /organizations` answering `[]` is a valid, documented first-install
 * state (ADR-0021 structural scoping: an unpinned deployment starts with zero
 * organizations, `docs/adr/0038-installation-bootstrap-of-the-pinned-deployment-organization.md`),
 * not an authorization failure — but until now the frontend offered no way to
 * act on it: the only real path was calling `POST /organizations` and
 * `POST /organizations/:id/members` by hand.
 *
 * This form calls exactly those two existing, unmodified endpoints, in the
 * existing order the backend already requires:
 *
 * 1. `createOrganization` — ordinary `Organization.Organization.Create`
 *    administration (`OrganizationsService.createOrganization`). Refused by
 *    the backend outright when the deployment is pinned, so this component
 *    is only ever useful in the unpinned mode it targets.
 * 2. `grantMembership` — ordinary `Organization.Membership.Grant`
 *    administration (`OrganizationMembershipsService.grantMembership`). The
 *    backend's own narrow first-member bootstrap exception (Task 19, ODR-3)
 *    is what allows the caller — who is not yet a member of anything — to
 *    grant themselves the first membership of the organization just
 *    created. Nothing here re-implements, widens, or bypasses that rule: a
 *    caller without `Organization.Membership.Grant`, or an organization that
 *    already has a member, is refused by the backend exactly as it always
 *    was.
 *
 * No organization or membership state is created, cached, or assumed on the
 * client: `onSuccess` only asks the existing `OrganizationContext` to
 * `refresh()` (re-run `GET /organizations`), so the app enters the workspace
 * only once the backend itself reports the organization and the membership
 * exist.
 */
export function CreateFirstOrganizationForm({
  userId,
  onCreated,
}: {
  userId: string;
  onCreated: () => void;
}) {
  const form = useForm<CreateFirstOrganizationFormValues>({
    resolver: zodResolver(createFirstOrganizationSchema),
    defaultValues: { code: '', name: '' },
    mode: 'onSubmit',
  });

  const mutation = useMutation({
    mutationFn: async (values: CreateFirstOrganizationFormValues) => {
      const organization = await createOrganization(values);
      await grantMembership(organization.id, { userId });
      return organization;
    },
    onSuccess: () => {
      onCreated();
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  const codeError = form.formState.errors.code?.message;
  const nameError = form.formState.errors.name?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.organization.createFirstTitle}</CardTitle>
        <CardDescription>{t.organization.createFirstBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <FormField
            id="organization-code"
            label={t.organization.createFirstCode}
            error={codeError}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="text"
                dir="ltr"
                disabled={mutation.isPending}
                {...form.register('code')}
              />
            )}
          </FormField>

          <FormField
            id="organization-name"
            label={t.organization.createFirstName}
            error={nameError}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="text"
                disabled={mutation.isPending}
                {...form.register('name')}
              />
            )}
          </FormField>

          {mutation.isError && <ApiErrorAlert error={mutation.error} />}

          <Button
            type="submit"
            className="w-full"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? t.organization.createFirstSubmitting
              : t.organization.createFirstSubmit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
