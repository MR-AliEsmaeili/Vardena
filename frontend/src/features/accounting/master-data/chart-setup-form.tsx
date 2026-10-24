import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createAccountingConfiguration,
  createCodingStructureVersion,
  getActiveAccountingConfiguration,
  getActiveCodingStructure,
  publishAccountingConfiguration,
  publishCodingStructureVersion,
} from '@/api/accounting.api';
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

interface LevelDraft {
  id: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
}
let nextLevelId = 3;

/**
 * One-shot chart bootstrap over existing endpoints: creates and publishes a
 * coding-structure version AND an accounting configuration built from the
 * SAME user-entered levels, satisfying the backend pin-coherence rule
 * (ODR-1) without inventing a default coding pattern. If either publish
 * fails, the error is shown and no success is claimed; drafts are harmless
 * and a retry creates a new version.
 */
export function ChartSetupForm({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('DEFAULT');
  const [name, setName] = useState('');
  const [levels, setLevels] = useState<LevelDraft[]>([
    { id: 1, title: '', digitLength: 2, defaultIsPostable: false },
    { id: 2, title: '', digitLength: 3, defaultIsPostable: true },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const codingActive = useQuery({
    queryKey: [
      ...queryKeys.accounting.all(organizationId),
      'coding-structure',
      'active',
    ],
    queryFn: ({ signal }) => getActiveCodingStructure(organizationId, signal),
  });
  const configActive = useQuery({
    queryKey: [
      ...queryKeys.accounting.all(organizationId),
      'accounting-configuration',
      'active',
    ],
    queryFn: ({ signal }) =>
      getActiveAccountingConfiguration(organizationId, signal),
  });
  const ready = codingActive.data != null && configActive.data != null;

  const mutation = useMutation({
    mutationFn: async () => {
      const payloadLevels = levels.map((level, index) => ({
        levelIndex: index + 1,
        title: level.title.trim(),
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable,
      }));
      if (codingActive.data == null) {
        const draft = await createCodingStructureVersion({
          organizationId,
          code: code.trim(),
          maxDepth: payloadLevels.length,
          separator: '',
          levels: payloadLevels,
        });
        await publishCodingStructureVersion(organizationId, draft.id);
      }
      if (configActive.data == null) {
        const draft = await createAccountingConfiguration({
          organizationId,
          code: code.trim(),
          name: name.trim(),
          levels: payloadLevels,
        });
        await publishAccountingConfiguration(organizationId, draft.id);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.all(organizationId),
      });
    },
  });

  if (codingActive.isPending || configActive.isPending) return null;
  if (ready)
    return (
      <output className="block text-sm text-success">
        {t.masterData.chartReady}
      </output>
    );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (code.trim() === '') {
      setFormError(t.masterData.codeRequired);
      return;
    }
    if (configActive.data == null && name.trim() === '') {
      setFormError(t.masterData.nameRequired);
      return;
    }
    if (
      levels.length === 0 ||
      levels.some(
        (l) =>
          l.title.trim() === '' ||
          !Number.isInteger(l.digitLength) ||
          l.digitLength < 1,
      )
    ) {
      setFormError(t.masterData.levelsRequired);
      return;
    }
    setFormError(null);
    mutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.masterData.setupChartTitle}</CardTitle>
        <CardDescription>{t.masterData.setupChartBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" noValidate onSubmit={submit}>
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
                            i === index ? { ...l, title: e.target.value } : l,
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
                              ? { ...l, digitLength: Number(e.target.value) }
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
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          {mutation.isError && <ApiErrorAlert error={mutation.error} />}
          {mutation.isSuccess && (
            <output className="block text-sm text-success">
              {t.masterData.setupChartDone}
            </output>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
            loading={mutation.isPending}
          >
            {mutation.isPending
              ? t.masterData.activating
              : t.masterData.activateChart}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
