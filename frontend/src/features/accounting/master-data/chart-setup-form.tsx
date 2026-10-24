import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createAccountingConfiguration,
  createCodingStructureVersion,
  getActiveAccountingConfiguration,
  getActiveCodingStructure,
  listAccountingConfigurations,
  listCodingStructureVersions,
  publishAccountingConfiguration,
  publishCodingStructureVersion,
} from '@/api/accounting.api';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
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
  classifyChartSetup,
  levelShapeOf,
  type LevelShape,
} from './chart-setup-state';

interface LevelDraft extends LevelShape {
  id: number;
}
let nextLevelId = 3;

const PAGE = { page: 1, pageSize: 100 } as const;

/**
 * Recoverable chart bootstrap over existing endpoints.
 *
 * State is always re-derived from the server (active aggregates + reusable
 * drafts) via `classifyChartSetup`: a retry after partial success reuses a
 * committed draft or the already-active side instead of restarting, inactive
 * mismatched drafts are never published over a fixed shape, and incompatible
 * ACTIVE aggregates block with an explanation — nothing is overwritten.
 * Success is only shown when both actives exist and are ODR-1 compatible in
 * the refetched state. Server authorization remains authoritative; the
 * permission checks below only decide which steps may be offered.
 */
export function ChartSetupForm({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const [code, setCode] = useState('DEFAULT');
  const [name, setName] = useState('');
  const [levels, setLevels] = useState<LevelDraft[]>([
    {
      id: 1,
      levelIndex: 1,
      title: '',
      digitLength: 2,
      defaultIsPostable: false,
    },
    {
      id: 2,
      levelIndex: 2,
      title: '',
      digitLength: 3,
      defaultIsPostable: true,
    },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const codingActive = useQuery({
    queryKey: queryKeys.accounting.codingStructureActive(organizationId),
    queryFn: ({ signal }) => getActiveCodingStructure(organizationId, signal),
  });
  const configActive = useQuery({
    queryKey:
      queryKeys.accounting.accountingConfigurationActive(organizationId),
    queryFn: ({ signal }) =>
      getActiveAccountingConfiguration(organizationId, signal),
  });
  const codingDrafts = useQuery({
    queryKey: queryKeys.accounting.codingStructureDrafts(organizationId),
    queryFn: ({ signal }) =>
      listCodingStructureVersions(
        { organizationId, status: 'draft', ...PAGE },
        signal,
      ),
  });
  const configDrafts = useQuery({
    queryKey:
      queryKeys.accounting.accountingConfigurationDrafts(organizationId),
    queryFn: ({ signal }) =>
      listAccountingConfigurations(
        { organizationId, status: 'DRAFT', ...PAGE },
        signal,
      ),
  });

  const stateQueries = [codingActive, configActive, codingDrafts, configDrafts];
  const stateLoading = stateQueries.some((q) => q.isPending);
  const stateError = stateQueries.find((q) => q.isError)?.error;
  const stateForbidden =
    stateError instanceof ApiError &&
    (stateError.status === 401 || stateError.status === 403);

  const setupKeys = [
    queryKeys.accounting.codingStructureActive(organizationId),
    queryKeys.accounting.codingStructureDrafts(organizationId),
    queryKeys.accounting.accountingConfigurationActive(organizationId),
    queryKeys.accounting.accountingConfigurationDrafts(organizationId),
  ] as const;
  const refreshState = async () => {
    await Promise.all(
      setupKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };

  const classification =
    !stateLoading && stateError === undefined
      ? classifyChartSetup({
          codingActive: codingActive.data ?? null,
          configActive: configActive.data ?? null,
          codingDrafts: codingDrafts.data?.items ?? [],
          configDrafts: configDrafts.data?.items ?? [],
        })
      : null;

  const canCoding = permissions.has(
    PERMISSIONS.accounting.codingStructureConfigure,
  );
  const canConfig = permissions.has(
    PERMISSIONS.accounting.accountingConfigurationConfigure,
  );

  const mutation = useMutation({
    mutationFn: async (userLevels: LevelShape[]) => {
      if (classification?.kind !== 'actionable') return;
      const plan = classification;
      const effectiveLevels: LevelShape[] =
        plan.lockedLevels ??
        userLevels.map((l, i) => ({ ...l, levelIndex: i + 1 }));
      // Re-check each side right before acting on it: a concurrent change
      // committed between classification and submit must not be overwritten.
      if (plan.codingAction !== 'none' && canCoding) {
        if (plan.codingAction === 'publish-draft' && plan.codingDraftId) {
          await publishCodingStructureVersion(
            organizationId,
            plan.codingDraftId,
          );
        } else {
          const draft = await createCodingStructureVersion({
            organizationId,
            code: code.trim(),
            maxDepth: effectiveLevels.length,
            separator: '',
            levels: effectiveLevels,
          });
          await publishCodingStructureVersion(organizationId, draft.id);
        }
      }
      if (plan.configAction !== 'none' && canConfig) {
        if (plan.configAction === 'publish-draft' && plan.configDraftId) {
          await publishAccountingConfiguration(
            organizationId,
            plan.configDraftId,
          );
        } else {
          const draft = await createAccountingConfiguration({
            organizationId,
            code: code.trim(),
            name: name.trim(),
            levels: effectiveLevels,
          });
          await publishAccountingConfiguration(organizationId, draft.id);
        }
      }
    },
    // Success AND partial failure both re-read the authoritative state, so
    // the next render (and any retry) is planned from server truth.
    onSettled: refreshState,
  });

  if (stateLoading) {
    return (
      <p className="text-sm text-ink-muted">{t.masterData.setupStateLoading}</p>
    );
  }

  if (stateError !== undefined) {
    return (
      <ApiErrorAlert
        error={stateError}
        description={
          stateForbidden
            ? t.masterData.setupForbidden
            : t.masterData.setupStateFailed
        }
        onRetry={() => void refreshState()}
      />
    );
  }

  if (classification?.kind === 'ready') {
    return (
      <output className="block text-sm text-success">
        {t.masterData.chartReady}
      </output>
    );
  }

  if (classification?.kind === 'blocked-incompatible') {
    return (
      <p role="alert" className="text-sm text-danger">
        {t.masterData.setupIncompatible}
      </p>
    );
  }

  const plan = classification?.kind === 'actionable' ? classification : null;
  const lockedLevels = plan?.lockedLevels ?? null;
  const editableLevels: LevelDraft[] =
    lockedLevels === null
      ? levels
      : lockedLevels.map((l, i) => ({ ...l, id: i + 1 }));
  const needsCoding = plan !== null && plan.codingAction !== 'none';
  const needsConfig = plan !== null && plan.configAction !== 'none';
  const missingPermission =
    (needsCoding && !canCoding) || (needsConfig && !canConfig);
  const canRun =
    plan !== null &&
    ((needsCoding && canCoding) || (needsConfig && canConfig)) &&
    !mutation.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canRun || mutation.isPending) return;
    if (lockedLevels === null) {
      if (code.trim() === '') return setFormError(t.masterData.codeRequired);
      if (
        needsConfig &&
        plan?.configAction === 'create-and-publish' &&
        name.trim() === ''
      )
        return setFormError(t.masterData.nameRequired);
      if (
        levels.length === 0 ||
        levels.some(
          (l) =>
            l.title.trim() === '' ||
            !Number.isInteger(l.digitLength) ||
            l.digitLength < 1,
        )
      )
        return setFormError(t.masterData.levelsRequired);
    }
    setFormError(null);
    mutation.mutate(levelShapeOf(editableLevels));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.masterData.setupChartTitle}</CardTitle>
        <CardDescription>{t.masterData.setupChartBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" noValidate onSubmit={submit}>
          {(codingActive.data != null ||
            configActive.data != null ||
            plan?.codingAction === 'publish-draft' ||
            plan?.configAction === 'publish-draft') && (
            <p className="text-sm text-ink-muted">
              {t.masterData.setupPartial}
            </p>
          )}
          <ul className="space-y-1 text-sm">
            <li>
              {t.masterData.codingStructureStep}:{' '}
              {codingActive.data != null
                ? t.masterData.setupStepDone
                : t.masterData.setupStepPending}
            </li>
            <li>
              {t.masterData.accountingConfigurationStep}:{' '}
              {configActive.data != null
                ? t.masterData.setupStepDone
                : t.masterData.setupStepPending}
            </li>
          </ul>
          {missingPermission && (
            <p role="alert" className="text-sm text-danger">
              {t.masterData.setupMissingPermission}
            </p>
          )}
          {lockedLevels === null && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="chart-code"
                  label={t.masterData.structureCode}
                  required
                >
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={mutation.isPending}
                    />
                  )}
                </FormField>
                <FormField
                  id="chart-name"
                  label={t.masterData.structureName}
                  required
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={mutation.isPending}
                    />
                  )}
                </FormField>
              </div>
              <div className="space-y-2">
                {levels.map((level, index) => (
                  <div
                    key={level.id}
                    className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_auto_auto]"
                  >
                    <FormField
                      id={`level-title-${index}`}
                      label={`${t.masterData.levelRow} ${index + 1} — ${t.masterData.levelTitle}`}
                      required
                    >
                      {(p) => (
                        <Input
                          {...p}
                          value={level.title}
                          onChange={(e) =>
                            setLevels(
                              levels.map((l, i) =>
                                i === index
                                  ? { ...l, title: e.target.value }
                                  : l,
                              ),
                            )
                          }
                          disabled={mutation.isPending}
                        />
                      )}
                    </FormField>
                    <FormField
                      id={`level-digits-${index}`}
                      label={t.masterData.digitLength}
                      required
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          min={1}
                          dir="ltr"
                          value={level.digitLength}
                          onChange={(e) =>
                            setLevels(
                              levels.map((l, i) =>
                                i === index
                                  ? {
                                      ...l,
                                      digitLength: Number(e.target.value),
                                    }
                                  : l,
                              ),
                            )
                          }
                          disabled={mutation.isPending}
                        />
                      )}
                    </FormField>
                    <label className="flex items-center gap-2 pb-2 text-xs">
                      <input
                        type="checkbox"
                        checked={level.defaultIsPostable}
                        onChange={(e) =>
                          setLevels(
                            levels.map((l, i) =>
                              i === index
                                ? { ...l, defaultIsPostable: e.target.checked }
                                : l,
                            ),
                          )
                        }
                        disabled={mutation.isPending}
                      />
                      {t.masterData.levelPostableDefault}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={levels.length <= 1 || mutation.isPending}
                      onClick={() =>
                        setLevels(levels.filter((_, i) => i !== index))
                      }
                    >
                      {t.masterData.removeLevel}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() =>
                    setLevels([
                      ...levels,
                      {
                        id: nextLevelId++,
                        levelIndex: levels.length + 1,
                        title: '',
                        digitLength: 2,
                        defaultIsPostable: false,
                      },
                    ])
                  }
                >
                  {t.masterData.addLevel}
                </Button>
              </div>
            </>
          )}
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          {mutation.isError && (
            <>
              <p role="alert" className="text-sm text-danger">
                {t.masterData.setupPartialFailure}
              </p>
              <ApiErrorAlert
                error={mutation.error}
                onRetry={() => void refreshState()}
              />
            </>
          )}
          <Button type="submit" disabled={!canRun} loading={mutation.isPending}>
            {mutation.isPending
              ? t.masterData.activating
              : t.masterData.activateChart}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
