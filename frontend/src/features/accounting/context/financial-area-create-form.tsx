import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createFinancialArea } from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
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

const MAX_CODE_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;

const financialAreaSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t.financialContext.codeRequired)
    .max(MAX_CODE_LENGTH),
  title: z
    .string()
    .trim()
    .min(1, t.financialContext.titleRequired)
    .max(MAX_TITLE_LENGTH),
});

type FinancialAreaFormValues = z.infer<typeof financialAreaSchema>;

/**
 * Explicit first-area creation used only by the empty financial-context
 * screen. The server remains responsible for permission, license, owning
 * organization and uniqueness checks; this form provides client-side feedback
 * and refreshes only the affected context query after a confirmed write.
 */
export function FinancialAreaCreateForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FinancialAreaFormValues>({
    resolver: zodResolver(financialAreaSchema),
    defaultValues: { code: '', title: '' },
    mode: 'onSubmit',
  });
  const mutation = useMutation({
    mutationFn: (values: FinancialAreaFormValues) =>
      createFinancialArea({
        organizationId,
        code: values.code.trim(),
        title: values.title.trim(),
      }),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.financialContextAreas(organizationId),
      });
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.financialContext.createAreaTitle}</CardTitle>
        <CardDescription>{t.financialContext.createAreaBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" noValidate onSubmit={onSubmit}>
          <FormField
            id="financial-area-code"
            label={t.financialContext.code}
            error={form.formState.errors.code?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('code')}
                dir="ltr"
                disabled={mutation.isPending}
              />
            )}
          </FormField>
          <FormField
            id="financial-area-title"
            label={t.financialContext.title}
            error={form.formState.errors.title?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('title')}
                disabled={mutation.isPending}
              />
            )}
          </FormField>
          {mutation.isError && <ApiErrorAlert error={mutation.error} />}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? t.financialContext.creating
              : t.financialContext.createArea}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
