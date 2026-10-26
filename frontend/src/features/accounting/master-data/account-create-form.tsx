import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  createAccount,
  listDetailGroups,
  MAX_PAGE_SIZE,
} from '@/api/accounting.api';
import type { Account } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useState } from 'react';
import { queryKeys } from '@/api/query-keys';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
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
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import {
  checkLocalCodeForm,
  derivedLevel,
  levelDefinition,
  orderedLevels,
  previewFullCode,
  type ConfigurationLevel,
} from './account-code';
import {
  useAccountParentCandidates,
  useActiveAccountingConfiguration,
} from './master-data-hooks';

/**
 * Build the schema from the ACTIVE configuration's levels and the eligible
 * parents, so the local-segment rule (digits only, exactly the level's
 * configured width) is checked against the level the SELECTED parent
 * implies. This is instant feedback only — the backend recomposes and
 * re-validates the full code authoritatively on submit.
 */
function buildSchema(
  levels: readonly ConfigurationLevel[],
  parentsById: ReadonlyMap<string, Account>,
) {
  return z
    .object({
      localCode: z.string(),
      title: z.string().trim().min(1, t.masterData.titleRequired).max(200),
      parentId: z.string(),
      accountNature: z.enum(['DEBIT', 'CREDIT', 'DUAL']),
      accountType: z.enum(['BALANCE_SHEET', 'INCOME_STATEMENT', 'MEMORANDUM']),
      /**
       * Tri-state on purpose: the API treats an OMITTED `isPostable` as "use
       * the coding structure's default for this level", and the old forced
       * `false` silently turned every account an operator created into an
       * aggregate account — which then never appeared in the document-line
       * picker.
       */
      postability: z.enum(['DEFAULT', 'YES', 'NO']),
      detailGroupId: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.parentId !== '' && !parentsById.has(values.parentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parentId'],
          message: t.masterData.parentLoadFailed,
        });
        return;
      }
      const parent =
        values.parentId === ''
          ? null
          : (parentsById.get(values.parentId) ?? null);
      const definition = levelDefinition(levels, derivedLevel(parent));
      if (definition === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['parentId'],
          message: t.masterData.levelBeyondStructure,
        });
        return;
      }
      const problem = checkLocalCodeForm(values.localCode, definition);
      if (problem === 'required') {
        ctx.addIssue({
          code: 'custom',
          path: ['localCode'],
          message: t.masterData.localCodeRequired,
        });
      } else if (problem === 'not_digits') {
        ctx.addIssue({
          code: 'custom',
          path: ['localCode'],
          message: t.masterData.localCodeDigits,
        });
      } else if (problem === 'wrong_length') {
        ctx.addIssue({
          code: 'custom',
          path: ['localCode'],
          message: t.masterData.localCodeLength.replace(
            '{digits}',
            formatCount(definition.digitLength),
          ),
        });
      }
    });
}
type Values = z.infer<ReturnType<typeof buildSchema>>;

/**
 * Create an account — POST /accounts with `localCode`,
 * `Accounting.Account.Create`.
 *
 * The operator picks the parent (empty = a level-1 root) and types ONLY
 * the local segment of the new account's own level (`003` under کل `101`).
 * The full code the backend will compose (`101003`) is previewed live and
 * updates with every parent/segment change; the level, its configured
 * segment width and its postable default are announced from the ACTIVE
 * accounting configuration. Level, pins, composition and every invariant
 * remain derived/validated by the backend — this form never sends a full
 * code it composed itself.
 */
export function AccountCreateForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const canViewDetails = permissions.has(PERMISSIONS.accounting.detailView);
  const [groupSearch, setGroupSearch] = useState('');
  const groups = useQuery({
    queryKey: queryKeys.accounting.detailGroupList(organizationId, groupSearch),
    queryFn: ({ signal }) =>
      listDetailGroups(
        {
          organizationId,
          page: 1,
          pageSize: MAX_PAGE_SIZE,
          isActive: true,
          ...(groupSearch ? { search: groupSearch } : {}),
        },
        signal,
      ),
    enabled: canViewDetails,
  });
  const configurationQuery = useActiveAccountingConfiguration(organizationId);
  const parentsQuery = useAccountParentCandidates(organizationId);

  const levels = useMemo(
    () => orderedLevels(configurationQuery.data?.levels),
    [configurationQuery.data],
  );
  const parents = useMemo(
    () => parentsQuery.data?.items ?? [],
    [parentsQuery.data],
  );
  const parentsById = useMemo(
    () => new Map(parents.map((account) => [account.id, account])),
    [parents],
  );
  const schema = useMemo(
    () => buildSchema(levels, parentsById),
    [levels, parentsById],
  );

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      localCode: '',
      title: '',
      parentId: '',
      accountNature: 'DUAL',
      accountType: 'BALANCE_SHEET',
      postability: 'DEFAULT',
      detailGroupId: '',
    },
    mode: 'onSubmit',
  });
  const watchedParentId =
    useWatch({ control: form.control, name: 'parentId' }) ?? '';
  const watchedLocalCode =
    useWatch({ control: form.control, name: 'localCode' }) ?? '';

  const selectedParent =
    watchedParentId === '' ? null : (parentsById.get(watchedParentId) ?? null);
  const level = derivedLevel(selectedParent);
  const definition = levelDefinition(levels, level);
  const fullCodePreview = previewFullCode(selectedParent, watchedLocalCode);

  // No active configuration (or its state still unknown) → no structure to
  // compose against; the form must not guess widths or invent a layout.
  const chartReady =
    configurationQuery.isSuccess && configurationQuery.data !== null;
  const parentsReady = parentsQuery.isSuccess;
  const formReady = chartReady && parentsReady;

  const mutation = useMutation({
    mutationFn: (values: Values) =>
      createAccount({
        organizationId,
        localCode: values.localCode.trim(),
        title: values.title.trim(),
        parentId: values.parentId === '' ? null : values.parentId,
        accountNature: values.accountNature,
        accountType: values.accountType,
        ...(canViewDetails && values.detailGroupId !== ''
          ? { detailGroupId: values.detailGroupId }
          : {}),
        ...(values.postability === 'DEFAULT'
          ? {}
          : { isPostable: values.postability === 'YES' }),
      }),
    onSuccess: async () => {
      form.reset();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.accounting.accountPrefix(organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.accounting.chartTree(organizationId),
        }),
      ]);
    },
  });
  const errors = form.formState.errors;
  const fieldsDisabled = mutation.isPending || !formReady;

  const localCodeHint =
    definition === undefined
      ? undefined
      : selectedParent === null
        ? `${t.masterData.localCodeLength.replace('{digits}', formatCount(definition.digitLength))} ${t.masterData.localCodeHintRoot}`
        : t.masterData.localCodeLength.replace(
            '{digits}',
            formatCount(definition.digitLength),
          );
  const postabilityHint =
    definition === undefined
      ? t.masterData.postableHint
      : t.masterData.levelDefaultPostable.replace(
          '{state}',
          definition.defaultIsPostable
            ? t.masterData.postable
            : t.masterData.aggregate,
        );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.masterData.createAccountTitle}</CardTitle>
        <CardDescription>{t.masterData.createAccountBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          {configurationQuery.isError && (
            <ApiErrorAlert
              error={configurationQuery.error}
              onRetry={() => void configurationQuery.refetch()}
            />
          )}
          {configurationQuery.isSuccess && configurationQuery.data === null && (
            <Alert variant="warning" role="alert">
              <AlertBody>
                <p>{t.masterData.chartNotReadyForAccount}</p>
              </AlertBody>
            </Alert>
          )}
          {canViewDetails && groups.isError && (
            <ApiErrorAlert
              error={groups.error}
              description={t.accountAdmin.groupLoadFailed}
              onRetry={() => void groups.refetch()}
            />
          )}
          {parentsQuery.isError && (
            <ApiErrorAlert
              error={parentsQuery.error}
              description={t.masterData.parentLoadFailed}
              onRetry={() => void parentsQuery.refetch()}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="account-parent"
              label={t.masterData.parentAccount}
              error={errors.parentId?.message}
            >
              {(p) => (
                <Select
                  {...p}
                  {...form.register('parentId')}
                  disabled={fieldsDisabled}
                >
                  <option value="">{t.masterData.rootParent}</option>
                  {parents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              id="account-local-code"
              label={t.masterData.localCode}
              required
              hint={localCodeHint}
              error={errors.localCode?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={definition?.digitLength ?? 32}
                  {...form.register('localCode')}
                  disabled={fieldsDisabled}
                />
              )}
            </FormField>
            <FormField
              id="account-title"
              label={t.masterData.accountTitle}
              required
              error={errors.title?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  {...form.register('title')}
                  disabled={fieldsDisabled}
                />
              )}
            </FormField>
            <FormField id="account-nature" label={t.masterData.nature}>
              {(p) => (
                <Select
                  {...p}
                  {...form.register('accountNature')}
                  disabled={fieldsDisabled}
                >
                  <option value="DEBIT">{t.masterData.natureDebit}</option>
                  <option value="CREDIT">{t.masterData.natureCredit}</option>
                  <option value="DUAL">{t.masterData.natureDual}</option>
                </Select>
              )}
            </FormField>
            <FormField id="account-type" label={t.masterData.accountType}>
              {(p) => (
                <Select
                  {...p}
                  {...form.register('accountType')}
                  disabled={fieldsDisabled}
                >
                  <option value="BALANCE_SHEET">
                    {t.masterData.balanceSheet}
                  </option>
                  <option value="INCOME_STATEMENT">
                    {t.masterData.incomeStatement}
                  </option>
                  <option value="MEMORANDUM">{t.masterData.memorandum}</option>
                </Select>
              )}
            </FormField>
            {canViewDetails && (
              <FormField
                id="account-create-group"
                label={t.masterData.detailGroup}
              >
                {(props) => (
                  <>
                    <Input
                      aria-label={t.accountAdmin.groupSearch}
                      value={groupSearch}
                      onChange={(event) => setGroupSearch(event.target.value)}
                    />
                    <Select
                      {...props}
                      {...form.register('detailGroupId')}
                      disabled={fieldsDisabled || groups.isPending}
                    >
                      <option value="">{t.accountAdmin.groupNone}</option>
                      {groups.data?.items.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.code} — {group.title}
                        </option>
                      ))}
                    </Select>
                  </>
                )}
              </FormField>
            )}
            <FormField
              id="account-postability"
              label={t.masterData.postableMode}
              hint={postabilityHint}
            >
              {(p) => (
                <Select
                  {...p}
                  {...form.register('postability')}
                  disabled={fieldsDisabled}
                >
                  <option value="DEFAULT">
                    {t.masterData.postableDefault}
                  </option>
                  <option value="YES">{t.masterData.postableYes}</option>
                  <option value="NO">{t.masterData.postableNo}</option>
                </Select>
              )}
            </FormField>
          </div>
          <div
            className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-card border border-line bg-sunken px-3 py-2 text-sm"
            aria-live="polite"
          >
            <span>
              {t.masterData.levelPreview}:{' '}
              <span className="num font-medium">{formatCount(level)}</span>
              {definition !== undefined && (
                <span className="text-ink-muted"> — {definition.title}</span>
              )}
            </span>
            <span>
              {t.masterData.fullCodePreview}:{' '}
              {fullCodePreview !== null ? (
                <span dir="ltr" className="code font-bold">
                  {fullCodePreview}
                </span>
              ) : (
                <span className="text-ink-muted">
                  {t.masterData.fullCodeIncomplete}
                </span>
              )}
            </span>
          </div>
          {chartReady && definition === undefined && (
            <p role="alert" className="text-sm text-danger-ink">
              {t.masterData.levelBeyondStructure}
            </p>
          )}
          {mutation.isError && <ApiErrorAlert error={mutation.error} />}
          {mutation.isSuccess && (
            <output className="block text-sm text-success">
              {t.masterData.accountCreated}
            </output>
          )}
          <Button
            type="submit"
            disabled={fieldsDisabled}
            loading={mutation.isPending}
          >
            {mutation.isPending
              ? t.masterData.creatingAccount
              : t.masterData.createAccount}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
