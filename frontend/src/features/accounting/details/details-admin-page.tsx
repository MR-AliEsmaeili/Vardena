import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  createDetail,
  disableDetail,
  enableDetail,
  getActiveDetailStructure,
  getDetailRecord,
  getDetailStructure,
  listDetails,
  updateDetail,
} from '@/api/accounting.api';
import type {
  AccountingDetail,
  AccountingDetailListQuery,
  CreateDetailRequest,
  UpdateDetailRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { DataTable } from '@/ui/patterns/data-table';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { useToast } from '@/ui/patterns/toast';

function createDetailColumns(
  visibleDetailsById: ReadonlyMap<string, AccountingDetail>,
): ColumnDef<AccountingDetail, unknown>[] {
  return [
    {
      accessorKey: 'code',
      header: t.details.code,
      cell: ({ row }) => (
        <Link
          className="code text-brand-ink hover:underline"
          dir="ltr"
          to={`/app/accounting/details/${row.original.id}`}
        >
          {row.original.code}
        </Link>
      ),
    },
    { accessorKey: 'title', header: t.details.name },
    { accessorKey: 'level', header: t.details.level },
    {
      id: 'parent',
      header: t.details.parent,
      cell: ({ row }) => {
        const rowParentId = row.original.parentId;
        if (rowParentId === null) return t.details.rootDetail;
        const parent = visibleDetailsById.get(rowParentId);
        return parent ? (
          <span title={parent.code}>
            {parent.code} — {parent.title}
          </span>
        ) : (
          <span className="code" dir="ltr" title={rowParentId}>
            {rowParentId.slice(-8)}
          </span>
        );
      },
    },
    {
      accessorKey: 'isPostable',
      header: t.details.postable,
      cell: ({ row }) => (row.original.isPostable ? t.app.yes : t.app.no),
    },
    {
      accessorKey: 'isActive',
      header: t.details.status,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive ? t.details.active : t.details.inactive}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t.orgAdmin.actions,
      cell: ({ row }) => <DetailRowActions detail={row.original} />,
    },
  ];
}

export function DetailsListPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get('pageSize') ?? 20)),
  );
  const search = searchParams.get('search') ?? '';
  const levelValue = searchParams.get('level') ?? '';
  const activeValue = searchParams.get('isActive') ?? '';
  const postableValue = searchParams.get('isPostable') ?? '';
  const parentFilterId = searchParams.get('parentId') ?? '';
  const filters = {
    page,
    pageSize,
    search,
    level: levelValue,
    activeValue,
    postableValue,
    parentId: parentFilterId,
  };
  const query = useQuery({
    queryKey: queryKeys.accounting.detailsList(
      organizationId ?? 'none',
      filters,
    ),
    enabled: organizationId !== null,
    queryFn: ({ signal }) => {
      if (organizationId === null)
        throw new Error('Organization context is required.');
      const params: AccountingDetailListQuery = {
        organizationId,
        page,
        pageSize,
        sort: 'code:asc',
        ...(search === '' ? {} : { search }),
        ...(levelValue === '' ? {} : { level: Number(levelValue) }),
        ...(activeValue === '' ? {} : { isActive: activeValue === 'true' }),
        ...(postableValue === ''
          ? {}
          : { isPostable: postableValue === 'true' }),
        ...(parentFilterId === '' ? {} : { parentId: parentFilterId }),
      };
      return listDetails(params, signal);
    },
    staleTime: 30_000,
  });
  const parentIds = useMemo(
    () =>
      Array.from(
        new Set(
          (query.data?.items ?? [])
            .map((detail) => detail.parentId)
            .filter(
              (candidateParentId): candidateParentId is string =>
                candidateParentId !== null,
            ),
        ),
      ),
    [query.data?.items],
  );
  const parentLookups = useQueries({
    queries: parentIds.map((parentDetailId) => ({
      queryKey: queryKeys.accounting.detailRecord(
        organizationId ?? 'none',
        parentDetailId,
      ),
      enabled: organizationId !== null,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (organizationId === null)
          throw new Error('Organization context is required.');
        return getDetailRecord(organizationId, parentDetailId, signal);
      },
      staleTime: 30_000,
    })),
  });
  const visibleDetailsById = new Map<string, AccountingDetail>();
  (query.data?.items ?? []).forEach((detail) =>
    visibleDetailsById.set(detail.id, detail),
  );
  parentLookups.forEach((lookup) => {
    if (lookup.data !== undefined)
      visibleDetailsById.set(lookup.data.id, lookup.data);
  });
  const canCreate = permissions.has(PERMISSIONS.accounting.detailCreate);
  const updateFilters = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next);
  };
  const columns = createDetailColumns(visibleDetailsById);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.details}
        description={t.details.subtitle}
        actions={
          canCreate ? (
            <Button asChild>
              <Link to="/app/accounting/details/new">{t.details.new}</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <FormField id="detail-search" label={t.app.search}>
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
        <FormField id="detail-level" label={t.details.level}>
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={8}
              value={levelValue}
              onChange={(event) =>
                updateFilters({ level: event.target.value, page: null })
              }
            />
          )}
        </FormField>
        <FormField id="detail-active" label={t.details.status}>
          {({ id }) => (
            <Select
              id={id}
              value={activeValue}
              onChange={(event) =>
                updateFilters({ isActive: event.target.value, page: null })
              }
            >
              <option value="">{t.masterData.allStatuses}</option>
              <option value="true">{t.details.active}</option>
              <option value="false">{t.details.inactive}</option>
            </Select>
          )}
        </FormField>
        <FormField id="detail-postable" label={t.details.postable}>
          {({ id }) => (
            <Select
              id={id}
              value={postableValue}
              onChange={(event) =>
                updateFilters({ isPostable: event.target.value, page: null })
              }
            >
              <option value="">{t.masterData.allStatuses}</option>
              <option value="true">{t.app.yes}</option>
              <option value="false">{t.app.no}</option>
            </Select>
          )}
        </FormField>
        <FormField id="detail-parent" label={t.details.parentId}>
          {({ id }) => (
            <Input
              id={id}
              dir="ltr"
              value={parentFilterId}
              onChange={(event) =>
                updateFilters({ parentId: event.target.value, page: null })
              }
              placeholder={t.details.rootFilter}
            />
          )}
        </FormField>
        <label className="flex min-h-9 items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={levelValue === '1'}
            onChange={(event) =>
              updateFilters({
                level: event.target.checked ? '1' : '',
                page: null,
              })
            }
          />
          {t.details.rootOnly}
        </label>
      </div>
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.nav.details}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.details.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.details.emptyTitle}
        emptyDescription={t.details.emptyBody}
        emptyAction={
          canCreate ? (
            <Button asChild variant="outline">
              <Link to="/app/accounting/details/new">{t.details.new}</Link>
            </Button>
          ) : undefined
        }
        pagination={{
          page: query.data?.page ?? page,
          pageSize: query.data?.pageSize ?? pageSize,
          total: query.data?.total ?? 0,
          onPageChange: (next) => updateFilters({ page: next }),
          onPageSizeChange: (next) =>
            updateFilters({ pageSize: next, page: 1 }),
        }}
      />
    </div>
  );
}

function DetailRowActions({ detail }: { detail: AccountingDetail }) {
  const permissions = usePermissions();
  const canEdit = permissions.has(PERMISSIONS.accounting.detailEdit);
  const canCreate = permissions.has(PERMISSIONS.accounting.detailCreate);
  const canEnable = permissions.has(PERMISSIONS.accounting.detailEnable);
  const canDisable = permissions.has(PERMISSIONS.accounting.detailDisable);
  const [confirm, setConfirm] = useState<'enable' | 'disable' | null>(null);
  const [failure, setFailure] = useState(false);
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const lifecycle = useMutation({
    mutationFn: () => {
      if (organizationId === null)
        throw new Error('Organization context is required.');
      return confirm === 'enable'
        ? enableDetail(organizationId, detail.id)
        : disableDetail(organizationId, detail.id);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(
        queryKeys.accounting.detailRecord(organizationId ?? 'none', next.id),
        next,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.detailsPrefix(organizationId ?? 'none'),
      });
      setConfirm(null);
      setFailure(false);
      showToast({
        kind: 'success',
        message: next.isActive ? t.details.enabled : t.details.disabled,
      });
    },
    onError: () => setFailure(true),
  });
  return (
    <div className="flex items-center gap-1">
      <Button asChild size="sm" variant="ghost">
        <Link to={`/app/accounting/details/${detail.id}`}>
          {t.orgAdmin.view}
        </Link>
      </Button>
      {canCreate && (
        <Button asChild size="sm" variant="ghost">
          <Link
            to={{
              pathname: '/app/accounting/details/new',
              search: new URLSearchParams({ parentId: detail.id }).toString(),
            }}
          >
            {t.details.addChild}
          </Link>
        </Button>
      )}
      {canEdit && (
        <Button asChild size="sm" variant="ghost">
          <Link to={`/app/accounting/details/${detail.id}/edit`}>
            {t.orgAdmin.edit}
          </Link>
        </Button>
      )}
      {!detail.isActive && canEnable && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirm('enable')}
        >
          {t.details.enable}
        </Button>
      )}
      {detail.isActive && canDisable && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirm('disable')}
        >
          {t.details.disable}
        </Button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'enable' ? t.details.enable : t.details.disable}
        description={
          confirm === 'enable' ? t.details.enableBody : t.details.disableBody
        }
        confirmLabel={
          confirm === 'enable' ? t.details.enable : t.details.disable
        }
        loading={lifecycle.isPending}
        onConfirm={() => lifecycle.mutate()}
        onCancel={() => {
          setConfirm(null);
          setFailure(false);
        }}
        error={failure ? t.details.lifecycleFailed : undefined}
      />
    </div>
  );
}

export function DetailFormPage({ mode }: { mode: 'create' | 'edit' | 'view' }) {
  const { detailId } = useParams<{ detailId: string }>();
  const [searchParams] = useSearchParams();
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState(() =>
    mode === 'create' ? (searchParams.get('parentId') ?? '') : '',
  );
  const [isPostable, setIsPostable] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const canReadDetails = permissions.has(PERMISSIONS.accounting.detailView);
  const detailQuery = useQuery({
    queryKey: queryKeys.accounting.detailRecord(
      organizationId ?? 'none',
      detailId ?? 'none',
    ),
    enabled:
      mode !== 'create' && organizationId !== null && detailId !== undefined,
    queryFn: ({ signal }) => {
      if (organizationId === null || detailId === undefined)
        throw new Error('Detail context is required.');
      return getDetailRecord(organizationId, detailId, signal);
    },
  });
  const parentQuery = useQuery({
    queryKey: queryKeys.accounting.detailsList(organizationId ?? 'none', {
      purpose: 'parent-picker',
    }),
    enabled: organizationId !== null && canReadDetails,
    queryFn: ({ signal }) => {
      if (organizationId === null)
        throw new Error('Organization context is required.');
      return listDetails(
        { organizationId, page: 1, pageSize: 100, sort: 'code:asc' },
        signal,
      );
    },
    staleTime: 30_000,
  });
  const activeStructureQuery = useQuery({
    queryKey: queryKeys.accounting.detailStructureActive(
      organizationId ?? 'none',
    ),
    enabled:
      organizationId !== null &&
      permissions.has(PERMISSIONS.accounting.detailStructureView),
    queryFn: ({ signal }) => {
      if (organizationId === null)
        throw new Error('Organization context is required.');
      return getActiveDetailStructure(organizationId, signal);
    },
  });
  const detail = detailQuery.data;
  const structureVersionQuery = useQuery({
    queryKey: queryKeys.accounting.detailStructureDetail(
      organizationId ?? 'none',
      detail?.detailStructureVersionId ?? 'none',
    ),
    enabled:
      mode === 'view' &&
      organizationId !== null &&
      detail !== undefined &&
      permissions.has(PERMISSIONS.accounting.detailStructureView),
    queryFn: ({ signal }) => {
      if (organizationId === null || detail === undefined)
        throw new Error('Detail structure context is required.');
      return getDetailStructure(
        organizationId,
        detail.detailStructureVersionId,
        signal,
      );
    },
  });

  const readOnly = mode === 'view';
  const structure = activeStructureQuery.data;
  const parents = (parentQuery.data?.items ?? []).filter(
    (item) => item.id !== detailId,
  );
  const parentRecord = parents.find((item) => item.id === detail?.parentId);
  const formCode = initialized ? code : (detail?.code ?? code);
  const formTitle = initialized ? title : (detail?.title ?? title);
  const formParentId = initialized ? parentId : (detail?.parentId ?? parentId);
  const formIsPostable = initialized
    ? isPostable
    : (detail?.isPostable ?? isPostable);
  const beginEditing = () => {
    if (initialized) return;
    if (detail !== undefined) {
      setCode(detail.code);
      setTitle(detail.title);
      setParentId(detail.parentId ?? '');
      setIsPostable(detail.isPostable);
    }
    setInitialized(true);
  };

  if (organizationId === null)
    return <LoadingState rows={4} label={t.loading.receiving} />;
  if (mode !== 'create' && detailQuery.isPending)
    return <LoadingState rows={4} label={t.loading.receiving} />;
  if (mode !== 'create' && detailQuery.isError)
    return (
      <ApiErrorAlert
        error={detailQuery.error}
        title={t.table.errorTitle}
        description={t.details.loadFailed}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  const submit = async () => {
    if (saving || readOnly) return;
    setFailure(null);
    if (mode === 'create' && formCode.trim() === '') {
      setFailure(t.details.codeRequired);
      return;
    }
    if (formTitle.trim() === '') {
      setFailure(t.details.titleRequired);
      return;
    }
    setSaving(true);
    try {
      let saved: AccountingDetail;
      if (mode === 'create') {
        const body: CreateDetailRequest = {
          organizationId,
          code: formCode.trim(),
          title: formTitle.trim(),
          parentId: formParentId === '' ? null : formParentId,
          isPostable: formIsPostable,
        };
        saved = await createDetail(body);
      } else {
        if (detailId === undefined) throw new Error('Detail id is required.');
        const body: UpdateDetailRequest = {
          title: formTitle.trim(),
          parentId: formParentId === '' ? null : formParentId,
          isPostable: formIsPostable,
        };
        saved = await updateDetail(organizationId, detailId, body);
      }
      queryClient.setQueryData(
        queryKeys.accounting.detailRecord(organizationId, saved.id),
        saved,
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.detailsPrefix(organizationId),
      });
      showToast({
        kind: 'success',
        message: mode === 'create' ? t.details.created : t.details.updated,
      });
      navigate(`/app/accounting/details/${saved.id}`, { replace: true });
    } catch {
      setFailure(t.details.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const titleText =
    mode === 'create'
      ? t.details.createTitle
      : mode === 'edit'
        ? t.details.editTitle
        : (detail?.title ?? t.nav.details);
  return (
    <div className="space-y-4">
      <PageHeader
        title={titleText}
        meta={
          mode !== 'create' && detail ? (
            <Badge variant={detail.isActive ? 'success' : 'neutral'}>
              {detail.isActive ? t.details.active : t.details.inactive}
            </Badge>
          ) : undefined
        }
        actions={
          mode === 'view' &&
          permissions.has(PERMISSIONS.accounting.detailEdit) ? (
            <Button asChild>
              <Link to={`/app/accounting/details/${detailId}/edit`}>
                {t.orgAdmin.edit}
              </Link>
            </Button>
          ) : undefined
        }
      />
      {mode !== 'create' && detail && (
        <p className="code text-xs text-ink-muted" dir="ltr">
          {detail.code}
        </p>
      )}
      {failure && (
        <ApiErrorAlert
          error={new Error(failure)}
          title={t.errors.title}
          description={failure}
        />
      )}
      {mode === 'create' &&
        structure === null &&
        permissions.has(PERMISSIONS.accounting.detailStructureView) && (
          <div className="rounded-control border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
            {t.details.noStructure}
            <Link
              className="ms-2 underline"
              to="/app/accounting/detail-structures"
            >
              {t.nav.detailStructures}
            </Link>
          </div>
        )}
      {mode === 'view' && detail ? (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <Definition label={t.details.code} value={detail.code} ltr />
            <Definition label={t.details.name} value={detail.title} />
            <Definition label={t.details.level} value={String(detail.level)} />
            <Definition
              label={t.details.parent}
              value={
                detail.parentId === null
                  ? t.details.rootDetail
                  : parentRecord
                    ? `${parentRecord.code} — ${parentRecord.title}`
                    : detail.parentId
              }
              ltr={detail.parentId !== null}
            />
            <Definition
              label={t.details.structureVersion}
              value={
                structureVersionQuery.data?.title ??
                (structureVersionQuery.data
                  ? `${t.structureAdmin.version} ${structureVersionQuery.data.versionNumber}`
                  : detail.detailStructureVersionId)
              }
            />
            <Definition
              label={t.details.postable}
              value={detail.isPostable ? t.app.yes : t.app.no}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4">
            {mode === 'create' && (
              <FormField id="detail-code" label={t.details.code} required>
                {({ id }) => (
                  <Input
                    id={id}
                    dir="ltr"
                    value={formCode}
                    onChange={(event) => {
                      beginEditing();
                      setCode(event.target.value);
                    }}
                  />
                )}
              </FormField>
            )}
            <FormField id="detail-title" label={t.details.name} required>
              {({ id }) => (
                <Input
                  id={id}
                  value={formTitle}
                  disabled={readOnly}
                  onChange={(event) => {
                    beginEditing();
                    setTitle(event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField id="detail-parent" label={t.details.parent}>
              {({ id }) => (
                <Select
                  id={id}
                  value={formParentId}
                  disabled={readOnly || !canReadDetails}
                  onChange={(event) => {
                    beginEditing();
                    setParentId(event.target.value);
                  }}
                >
                  <option value="">{t.details.rootDetail}</option>
                  {parents.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formIsPostable}
                disabled={readOnly}
                onChange={(event) => {
                  beginEditing();
                  setIsPostable(event.target.checked);
                }}
              />
              {t.details.postable}
            </label>
            {mode === 'edit' && detail && (
              <p className="text-xs text-ink-muted">
                {t.details.codeImmutable}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button asChild variant="outline">
                <Link
                  to={
                    mode === 'create'
                      ? '/app/accounting/details'
                      : `/app/accounting/details/${detailId}`
                  }
                >
                  {t.app.cancel}
                </Link>
              </Button>
              {!readOnly && (
                <Button
                  type="button"
                  onClick={() => void submit()}
                  loading={saving}
                >
                  {saving ? t.orgAdmin.saving : t.orgAdmin.save}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
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
