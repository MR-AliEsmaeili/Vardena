import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CellContext, ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  createCodingStructureVersion,
  createDetailStructureVersion,
  getCodingStructure,
  getDetailStructure,
  listCodingStructureVersions,
  listDetailStructures,
  listDetails,
  publishCodingStructureVersion,
  publishDetailStructureVersion,
  updateCodingStructureVersion,
  updateDetailStructureVersion,
} from '@/api/accounting.api';
import type {
  CodingStructureListQuery,
  CodingStructureVersion,
  CreateCodingStructureRequest,
  CreateDetailStructureRequest,
  DetailStructureListQuery,
  DetailStructureVersion,
  UpdateCodingStructureRequest,
  UpdateDetailStructureRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatInstant, useTimeZone } from '@/lib/datetime';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { DataTable } from '@/ui/patterns/data-table';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { PageHeader } from '@/ui/patterns/page-header';
import { useToast } from '@/ui/patterns/toast';
import { Select } from '@/ui/select';

export type StructureKind = 'coding' | 'detail';
type Version = CodingStructureVersion | DetailStructureVersion;
type StructureStatus = Version['status'];

interface LevelDraft {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string;
}

const STATUS_LABELS: Record<StructureStatus, string> = {
  draft: t.structureAdmin.draft,
  active: t.structureAdmin.active,
  superseded: t.structureAdmin.superseded,
};

const STATUS_VARIANTS: Record<StructureStatus, 'info' | 'success' | 'neutral'> =
  {
    draft: 'info',
    active: 'success',
    superseded: 'neutral',
  };

function basePath(kind: StructureKind): string {
  return `/app/accounting/${kind === 'coding' ? 'coding-structures' : 'detail-structures'}`;
}

function emptyLevel(index: number): LevelDraft {
  return {
    levelIndex: index,
    title: '',
    digitLength: 2,
    defaultIsPostable: index > 1,
    levelKind: '',
  };
}

function statusQuery(
  value: string,
): 'draft' | 'active' | 'superseded' | undefined {
  return value === 'draft' || value === 'active' || value === 'superseded'
    ? value
    : undefined;
}

function versionTitle(version: Version): string {
  return 'code' in version
    ? version.code
    : (version.title ?? t.structureAdmin.untitled);
}

function codingSeparator(value: string): '-' | '/' | '.' | '' {
  return value === '-' || value === '/' || value === '.' ? value : '';
}

function createStructureColumns(
  kind: StructureKind,
  timeZone: string,
): ColumnDef<Version, unknown>[] {
  return [
    {
      id: 'title',
      header:
        kind === 'coding' ? t.structureAdmin.code : t.structureAdmin.title,
      cell: ({ row }) => (
        <Link
          className="font-medium text-brand-ink hover:underline"
          to={`${basePath(kind)}/${row.original.id}`}
        >
          <span dir={kind === 'coding' ? 'ltr' : undefined}>
            {versionTitle(row.original)}
          </span>
        </Link>
      ),
    },
    {
      accessorKey: 'versionNumber',
      header: t.structureAdmin.version,
      cell: ({ row }) => <span dir="ltr">{row.original.versionNumber}</span>,
    },
    {
      accessorKey: 'status',
      header: t.structureAdmin.status,
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANTS[row.original.status]}>
          {STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    { accessorKey: 'maxDepth', header: t.structureAdmin.depth },
    ...(kind === 'coding'
      ? [
          {
            id: 'separator',
            header: t.structureAdmin.separator,
            cell: ({ row }: CellContext<Version, unknown>) =>
              'separator' in row.original
                ? row.original.separator || t.structureAdmin.noSeparator
                : t.app.none,
          } satisfies ColumnDef<Version, unknown>,
        ]
      : []),
    {
      accessorKey: 'pattern',
      header: t.structureAdmin.pattern,
      cell: ({ row }) => (
        <span className="code" dir="ltr">
          {row.original.pattern}
        </span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: t.orgAdmin.updatedAt,
      cell: ({ row }) => (
        <span dir="ltr">{formatInstant(row.original.updatedAt, timeZone)}</span>
      ),
    },
  ];
}

function codingLevelKind(
  value: string,
): 'group' | 'general' | 'subsidiary' | 'detail' | null {
  return value === 'group' ||
    value === 'general' ||
    value === 'subsidiary' ||
    value === 'detail'
    ? value
    : null;
}

export function StructureListPage({ kind }: { kind: StructureKind }) {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const canConfigure = permissions.has(
    kind === 'coding'
      ? PERMISSIONS.accounting.codingStructureConfigure
      : PERMISSIONS.accounting.detailStructureConfigure,
  );
  const timeZone = useTimeZone();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get('pageSize') ?? 20)),
  );
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';
  const statusFilter = statusQuery(status);
  const filters = { page, pageSize, search, status };
  const queryKey = [
    'accounting',
    organizationId ?? 'none',
    `${kind}-structures`,
    'list',
    filters,
  ] as const;

  const query = useQuery<{
    items: Version[];
    total: number;
    page: number;
    pageSize: number;
  }>({
    queryKey,
    enabled: organizationId !== null,
    queryFn: async ({
      signal,
    }): Promise<{
      items: Version[];
      total: number;
      page: number;
      pageSize: number;
    }> => {
      if (organizationId === null)
        throw new Error('Organization context is required.');
      if (kind === 'coding') {
        const params: CodingStructureListQuery = {
          organizationId,
          page,
          pageSize,
          sort: 'versionNumber:desc',
          ...(search === '' ? {} : { search }),
          ...(statusFilter === undefined ? {} : { status: statusFilter }),
        };
        const result = await listCodingStructureVersions(params, signal);
        return { ...result, items: result.items };
      }
      const params: DetailStructureListQuery = {
        organizationId,
        page,
        pageSize,
        sort: 'versionNumber:desc',
        ...(statusFilter === undefined ? {} : { status: statusFilter }),
      };
      const result = await listDetailStructures(params, signal);
      return { ...result, items: result.items };
    },
    staleTime: 30_000,
  });

  const updateFilters = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next);
  };

  const columns = useMemo(
    () => createStructureColumns(kind, timeZone),
    [kind, timeZone],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          kind === 'coding' ? t.nav.codingStructures : t.nav.detailStructures
        }
        description={t.structureAdmin.listDescription}
        actions={
          canConfigure ? (
            <Button asChild>
              <Link to={`${basePath(kind)}/new`}>
                {t.structureAdmin.newVersion}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <section
        aria-label={t.app.search}
        className="flex flex-wrap items-end gap-2"
      >
        {kind === 'coding' && (
          <FormField id="structure-search" label={t.app.search}>
            {({ id }) => (
              <Input
                id={id}
                value={search}
                onChange={(event) =>
                  updateFilters({ search: event.target.value, page: null })
                }
              />
            )}
          </FormField>
        )}
        <FormField id="structure-status" label={t.structureAdmin.status}>
          {({ id }) => (
            <Select
              id={id}
              value={status}
              onChange={(event) =>
                updateFilters({ status: event.target.value, page: null })
              }
            >
              <option value="">{t.masterData.allStatuses}</option>
              <option value="draft">{t.structureAdmin.draft}</option>
              <option value="active">{t.structureAdmin.active}</option>
              <option value="superseded">{t.structureAdmin.superseded}</option>
            </Select>
          )}
        </FormField>
      </section>
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={
          kind === 'coding' ? t.nav.codingStructures : t.nav.detailStructures
        }
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.structureAdmin.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.structureAdmin.emptyTitle}
        emptyDescription={t.structureAdmin.emptyBody}
        pagination={{
          page: query.data?.page ?? page,
          pageSize: query.data?.pageSize ?? pageSize,
          total: query.data?.total ?? 0,
          onPageChange: (nextPage) => updateFilters({ page: nextPage }),
          onPageSizeChange: (nextPageSize) =>
            updateFilters({ pageSize: nextPageSize, page: 1 }),
        }}
      />
    </div>
  );
}

export function StructureDetailPage({ kind }: { kind: StructureKind }) {
  const { structureId } = useParams<{ structureId: string }>();
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const canConfigure = permissions.has(
    kind === 'coding'
      ? PERMISSIONS.accounting.codingStructureConfigure
      : PERMISSIONS.accounting.detailStructureConfigure,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const path = basePath(kind);
  const detailKey =
    kind === 'coding'
      ? queryKeys.accounting.codingStructureDetail(
          organizationId ?? 'none',
          structureId ?? 'none',
        )
      : queryKeys.accounting.detailStructureDetail(
          organizationId ?? 'none',
          structureId ?? 'none',
        );
  const query = useQuery<Version>({
    queryKey: detailKey,
    enabled: organizationId !== null && structureId !== undefined,
    queryFn: async ({ signal }): Promise<Version> => {
      if (organizationId === null || structureId === undefined)
        throw new Error('Structure context is required.');
      return kind === 'coding'
        ? await getCodingStructure(organizationId, structureId, signal)
        : await getDetailStructure(organizationId, structureId, signal);
    },
  });
  const detailCountQuery = useQuery({
    queryKey: queryKeys.accounting.detailsList(organizationId ?? 'none', {
      purpose: 'detail-structure-usage',
      structureId: structureId ?? 'none',
    }),
    enabled:
      kind === 'detail' &&
      organizationId !== null &&
      structureId !== undefined &&
      permissions.has(PERMISSIONS.accounting.detailView),
    queryFn: ({ signal }) => {
      if (organizationId === null || structureId === undefined)
        throw new Error('Detail structure context is required.');
      return listDetails(
        {
          organizationId,
          page: 1,
          pageSize: 1,
          detailStructureVersionId: structureId,
        },
        signal,
      );
    },
  });
  const publish = useMutation<Version, Error>({
    mutationFn: async (): Promise<Version> => {
      if (organizationId === null || structureId === undefined)
        throw new Error('Structure context is required.');
      return kind === 'coding'
        ? publishCodingStructureVersion(organizationId, structureId)
        : publishDetailStructureVersion(organizationId, structureId);
    },
    onSuccess: (version) => {
      queryClient.setQueryData(detailKey, version);
      void queryClient.invalidateQueries({
        queryKey:
          kind === 'coding'
            ? queryKeys.accounting.codingStructurePrefix(
                organizationId ?? 'none',
              )
            : queryKeys.accounting.detailStructurePrefix(
                organizationId ?? 'none',
              ),
      });
      setPublishOpen(false);
      showToast({ kind: 'success', message: t.structureAdmin.published });
    },
  });

  if (query.isPending)
    return <LoadingState rows={5} label={t.loading.receiving} />;
  if (query.isError) {
    return (
      <ApiErrorAlert
        error={query.error}
        title={t.table.errorTitle}
        description={t.structureAdmin.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const structure = query.data;
  const title = versionTitle(structure);
  return (
    <div className="space-y-4">
      <FormPageHeader
        title={title}
        meta={
          <Badge variant={STATUS_VARIANTS[structure.status]}>
            {STATUS_LABELS[structure.status]}
          </Badge>
        }
        actions={
          <>
            {canConfigure && structure.status === 'draft' && (
              <>
                <Button asChild variant="outline">
                  <Link to={`${path}/${structure.id}/edit`}>
                    {t.structureAdmin.edit}
                  </Link>
                </Button>
                <Button onClick={() => setPublishOpen(true)}>
                  {t.structureAdmin.publish}
                </Button>
              </>
            )}
            <Button asChild variant="ghost">
              <Link to={path}>{t.app.backToPrevious}</Link>
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Definition
            label={t.structureAdmin.version}
            value={String(structure.versionNumber)}
          />
          <Definition
            label={t.structureAdmin.depth}
            value={String(structure.maxDepth)}
          />
          <Definition
            label={t.structureAdmin.pattern}
            value={structure.pattern}
            ltr
          />
          {kind === 'detail' &&
            permissions.has(PERMISSIONS.accounting.detailView) && (
              <Definition
                label={t.structureAdmin.detailCount}
                value={
                  detailCountQuery.data
                    ? formatCount(detailCountQuery.data.total)
                    : detailCountQuery.isError
                      ? t.structureAdmin.countUnavailable
                      : t.loading.receiving
                }
              />
            )}
          {'separator' in structure && (
            <Definition
              label={t.structureAdmin.separator}
              value={structure.separator || t.structureAdmin.noSeparator}
            />
          )}
        </CardContent>
      </Card>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">{t.structureAdmin.levels}</caption>
          <thead className="bg-sunken text-start">
            <tr>
              <th className="p-2">{t.structureAdmin.levelIndex}</th>
              <th className="p-2">{t.structureAdmin.levelTitle}</th>
              <th className="p-2">{t.structureAdmin.digitLength}</th>
              {kind === 'coding' && (
                <th className="p-2">{t.structureAdmin.defaultPostable}</th>
              )}
              {kind === 'coding' && (
                <th className="p-2">{t.structureAdmin.levelKind}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {structure.levels.map((level) => (
              <tr key={level.levelIndex} className="border-t border-line">
                <td className="p-2">{level.levelIndex}</td>
                <td className="p-2">{level.title}</td>
                <td className="p-2">{level.digitLength}</td>
                {'defaultIsPostable' in level && (
                  <td className="p-2">
                    {level.defaultIsPostable ? t.app.yes : t.app.no}
                  </td>
                )}
                {'defaultIsPostable' in level && (
                  <td className="p-2">
                    {String(level.levelKind ?? t.app.none)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={publishOpen}
        title={t.structureAdmin.publishTitle}
        description={
          kind === 'coding'
            ? t.structureAdmin.publishCodingBody
            : t.structureAdmin.publishDetailBody
        }
        confirmLabel={t.structureAdmin.publish}
        loading={publish.isPending}
        loadingLabel={t.structureAdmin.publishing}
        onConfirm={() => publish.mutate()}
        onCancel={() => setPublishOpen(false)}
        error={publish.error ? t.structureAdmin.publishFailed : undefined}
      />
    </div>
  );
}

function Definition({
  label,
  value,
  ltr = false,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-1 truncate font-medium" dir={ltr ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  );
}

export function StructureFormPage({
  kind,
  mode,
}: {
  kind: StructureKind;
  mode: 'create' | 'edit';
}) {
  const { structureId } = useParams<{ structureId: string }>();
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const path = basePath(kind);
  const detailKey =
    kind === 'coding'
      ? queryKeys.accounting.codingStructureDetail(
          organizationId ?? 'none',
          structureId ?? 'none',
        )
      : queryKeys.accounting.detailStructureDetail(
          organizationId ?? 'none',
          structureId ?? 'none',
        );
  const query = useQuery<Version>({
    queryKey: detailKey,
    enabled:
      mode === 'edit' && organizationId !== null && structureId !== undefined,
    queryFn: async ({ signal }): Promise<Version> => {
      if (organizationId === null || structureId === undefined)
        throw new Error('Structure context is required.');
      return kind === 'coding'
        ? await getCodingStructure(organizationId, structureId, signal)
        : await getDetailStructure(organizationId, structureId, signal);
    },
  });
  const structure = mode === 'edit' ? query.data : undefined;
  const readOnly = structure !== undefined && structure.status !== 'draft';
  const [code, setCode] = useState('DEFAULT');
  const [title, setTitle] = useState('');
  const [maxDepth, setMaxDepth] = useState(3);
  const [separator, setSeparator] = useState('-');
  const [levels, setLevels] = useState<LevelDraft[]>([
    emptyLevel(1),
    emptyLevel(2),
    emptyLevel(3),
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const displayCode = initialized
    ? code
    : structure && 'code' in structure
      ? structure.code
      : code;
  const displayTitle = initialized
    ? title
    : structure && 'title' in structure
      ? (structure.title ?? '')
      : title;
  const displayDepth = initialized
    ? maxDepth
    : (structure?.maxDepth ?? maxDepth);
  const displaySeparator = initialized
    ? separator
    : structure && 'separator' in structure
      ? structure.separator
      : separator;
  const displayLevels =
    initialized || structure === undefined
      ? levels
      : structure.levels.map((level) => {
          const coding = 'defaultIsPostable' in level ? level : undefined;
          return {
            levelIndex: level.levelIndex,
            title: level.title,
            digitLength: level.digitLength,
            defaultIsPostable: coding?.defaultIsPostable ?? false,
            levelKind:
              typeof coding?.levelKind === 'string' ? coding.levelKind : '',
          };
        });
  const beginEditing = () => {
    if (initialized) return;
    if (structure !== undefined) {
      setCode('code' in structure ? structure.code : '');
      setTitle('title' in structure ? (structure.title ?? '') : '');
      setMaxDepth(structure.maxDepth);
      setSeparator('separator' in structure ? structure.separator : '-');
      setLevels(displayLevels);
    }
    setInitialized(true);
  };

  const totalLength = displayLevels.reduce(
    (sum, level) =>
      sum + (Number.isFinite(level.digitLength) ? level.digitLength : 0),
    0,
  );
  const structurePrefix =
    kind === 'coding'
      ? queryKeys.accounting.codingStructurePrefix(organizationId ?? 'none')
      : queryKeys.accounting.detailStructurePrefix(organizationId ?? 'none');

  if (organizationId === null)
    return <LoadingState rows={4} label={t.loading.receiving} />;
  if (mode === 'edit' && query.isPending)
    return <LoadingState rows={4} label={t.loading.receiving} />;
  if (mode === 'edit' && query.isError)
    return (
      <ApiErrorAlert
        error={query.error}
        title={t.table.errorTitle}
        description={t.structureAdmin.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );

  const resizeLevels = (depth: number) => {
    const nextDepth = Number.isInteger(depth)
      ? Math.max(1, Math.min(8, depth))
      : 1;
    beginEditing();
    setMaxDepth(depth);
    setLevels(
      Array.from(
        { length: nextDepth },
        (_, index) => displayLevels[index] ?? emptyLevel(index + 1),
      ).map((row, index) => ({ ...row, levelIndex: index + 1 })),
    );
  };

  const submit = async () => {
    if (readOnly || submitting) return;
    setFormError(null);
    const trimmedCode = displayCode.trim();
    if (kind === 'coding' && mode === 'create' && trimmedCode === '') {
      setFormError(t.structureAdmin.codeRequired);
      return;
    }
    if (
      displayLevels.length !== displayDepth ||
      displayLevels.some(
        (level, index) =>
          level.levelIndex !== index + 1 ||
          level.title.trim() === '' ||
          !Number.isInteger(level.digitLength) ||
          level.digitLength < 1,
      )
    ) {
      setFormError(t.structureAdmin.levelsInvalid);
      return;
    }
    if (totalLength > 32) {
      setFormError(t.structureAdmin.totalLengthExceeded);
      return;
    }
    setSubmitting(true);
    try {
      let result: Version;
      if (kind === 'coding') {
        const levelInputs = displayLevels.map((level) => ({
          levelIndex: level.levelIndex,
          title: level.title.trim(),
          digitLength: level.digitLength,
          defaultIsPostable: level.defaultIsPostable,
          levelKind: codingLevelKind(level.levelKind),
        }));
        result =
          mode === 'create'
            ? await createCodingStructureVersion({
                organizationId,
                code: trimmedCode,
                maxDepth: displayDepth,
                separator: codingSeparator(displaySeparator),
                levels: levelInputs,
              } satisfies CreateCodingStructureRequest)
            : await updateCodingStructureVersion(
                organizationId,
                structureId ?? '',
                {
                  maxDepth: displayDepth,
                  separator: codingSeparator(displaySeparator),
                  levels: levelInputs,
                } satisfies UpdateCodingStructureRequest,
              );
      } else {
        const levelInputs = displayLevels.map((level) => ({
          levelIndex: level.levelIndex,
          title: level.title.trim(),
          digitLength: level.digitLength,
        }));
        result =
          mode === 'create'
            ? await createDetailStructureVersion({
                organizationId,
                maxDepth: displayDepth,
                levels: levelInputs,
                ...(displayTitle.trim() === ''
                  ? {}
                  : { title: displayTitle.trim() }),
              } satisfies CreateDetailStructureRequest)
            : await updateDetailStructureVersion(
                organizationId,
                structureId ?? '',
                {
                  maxDepth: displayDepth,
                  levels: levelInputs,
                  ...(displayTitle.trim() === ''
                    ? {}
                    : { title: displayTitle.trim() }),
                } satisfies UpdateDetailStructureRequest,
              );
      }
      queryClient.setQueryData(detailKey, result);
      await queryClient.invalidateQueries({ queryKey: structurePrefix });
      showToast({ kind: 'success', message: t.structureAdmin.saved });
      navigate(
        mode === 'create' ? `${path}/${result.id}` : `${path}/${result.id}`,
        { replace: true },
      );
    } catch {
      setFormError(t.structureAdmin.saveFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <FormPageHeader
        title={
          mode === 'create'
            ? t.structureAdmin.newVersion
            : t.structureAdmin.editTitle
        }
        description={readOnly ? t.structureAdmin.readOnlyPublished : undefined}
      />
      {formError && (
        <ApiErrorAlert
          error={new Error(formError)}
          title={t.errors.title}
          description={formError}
        />
      )}
      <Card>
        <CardContent className="space-y-4 p-4">
          {kind === 'coding' ? (
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t.structureAdmin.code}</span>
              <Input
                dir="ltr"
                value={displayCode}
                disabled={mode === 'edit' || readOnly}
                onChange={(event) => {
                  beginEditing();
                  setCode(event.target.value);
                }}
              />
            </label>
          ) : (
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t.structureAdmin.title}</span>
              <Input
                value={displayTitle}
                disabled={readOnly}
                onChange={(event) => {
                  beginEditing();
                  setTitle(event.target.value);
                }}
              />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t.structureAdmin.depth}</span>
              <Input
                type="number"
                min={1}
                max={8}
                value={displayDepth}
                disabled={readOnly}
                onChange={(event) => resizeLevels(Number(event.target.value))}
              />
            </label>
            {kind === 'coding' && (
              <label className="block space-y-1.5 text-sm font-medium">
                <span>{t.structureAdmin.separator}</span>
                <Select
                  value={displaySeparator}
                  disabled={readOnly}
                  onChange={(event) => {
                    beginEditing();
                    setSeparator(event.target.value);
                  }}
                >
                  <option value="">{t.structureAdmin.noSeparator}</option>
                  <option value="-">-</option>
                  <option value="/">/</option>
                  <option value=".">.</option>
                </Select>
              </label>
            )}
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">{t.structureAdmin.levels}</h2>
            {displayLevels.map((level, index) => (
              <div
                key={level.levelIndex}
                className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <label className="block space-y-1.5 text-xs font-medium">
                  <span>{t.structureAdmin.levelIndex}</span>
                  <Input value={level.levelIndex} readOnly dir="ltr" />
                </label>
                <label className="block space-y-1.5 text-xs font-medium">
                  <span>{t.structureAdmin.levelTitle}</span>
                  <Input
                    value={level.title}
                    disabled={readOnly}
                    onChange={(event) => {
                      beginEditing();
                      setLevels((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, title: event.target.value }
                            : row,
                        ),
                      );
                    }}
                  />
                </label>
                <label className="block space-y-1.5 text-xs font-medium">
                  <span>{t.structureAdmin.digitLength}</span>
                  <Input
                    type="number"
                    min={1}
                    max={32}
                    value={level.digitLength}
                    disabled={readOnly}
                    onChange={(event) => {
                      beginEditing();
                      setLevels((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                digitLength: Number(event.target.value),
                              }
                            : row,
                        ),
                      );
                    }}
                  />
                </label>
                {kind === 'coding' && (
                  <div className="flex flex-col justify-center gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={level.defaultIsPostable}
                        disabled={readOnly}
                        onChange={(event) => {
                          beginEditing();
                          setLevels((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index
                                ? {
                                    ...row,
                                    defaultIsPostable: event.target.checked,
                                  }
                                : row,
                            ),
                          );
                        }}
                      />
                      {t.structureAdmin.defaultPostable}
                    </label>
                    <label className="block space-y-1.5 text-xs font-medium">
                      <span>{t.structureAdmin.levelKind}</span>
                      <Select
                        value={level.levelKind}
                        disabled={readOnly}
                        onChange={(event) => {
                          beginEditing();
                          setLevels((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, levelKind: event.target.value }
                                : row,
                            ),
                          );
                        }}
                      >
                        <option value="">{t.app.none}</option>
                        <option value="group">
                          {t.structureAdmin.kindGroup}
                        </option>
                        <option value="general">
                          {t.structureAdmin.kindGeneral}
                        </option>
                        <option value="subsidiary">
                          {t.structureAdmin.kindSubsidiary}
                        </option>
                        <option value="detail">
                          {t.structureAdmin.kindDetail}
                        </option>
                      </Select>
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-xs text-ink-muted">
              {t.structureAdmin.totalLength}:{' '}
              <span dir="ltr" className="code">
                {totalLength}
              </span>{' '}
              / 32 · {t.structureAdmin.patternPreview}:{' '}
              <span dir="ltr" className="code">
                {displayLevels
                  .map((level) => level.digitLength)
                  .join(kind === 'coding' ? displaySeparator : ' + ')}
              </span>
            </p>
            <Button
              type="button"
              onClick={() => void submit()}
              loading={submitting}
              disabled={readOnly}
            >
              {submitting ? t.structureAdmin.saving : t.structureAdmin.save}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
