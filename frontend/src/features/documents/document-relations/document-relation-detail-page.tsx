import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatInstant, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { LoadingState } from '@/ui/patterns/states';
import { documentRelationErrorMessage } from './document-relations-error-messages';
import { useDeleteDocumentRelationMutation, useDocumentRelation } from './use-document-relations';

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    reference: t.documentRelations.kinds.reference,
    derive: t.documentRelations.kinds.derive,
    fulfill: t.documentRelations.kinds.fulfill,
    settle: t.documentRelations.kinds.settle,
    reverse: t.documentRelations.kinds.reverse,
    transfer_of: t.documentRelations.kinds.transferOf,
  };
  return map[kind] ?? kind;
}

/**
 * Document relation detail (DOC-03).
 *
 * Four states for the relation itself; delete is hard delete gated by
 * `Document.Relation.Delete` and does not touch documents.
 */
export function DocumentRelationDetailPage() {
  const organizationId = useOrganizationId();
  const { relationId } = useParams<{ relationId: string }>();
  const navigate = useNavigate();
  const timeZone = useTimeZone();
  const detailQuery = useDocumentRelation(organizationId, relationId);

  const deleteMutation = useDeleteDocumentRelationMutation(organizationId ?? 'none', relationId ?? 'none');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (organizationId === null || relationId === undefined) {
    return <LoadingState rows={5} label={t.loading.receiving} />;
  }

  if (detailQuery.isPending) {
    return <LoadingState rows={6} label={t.loading.receiving} />;
  }

  if (detailQuery.isError) {
    return (
      <div className="space-y-4">
        <FormPageHeader title={t.documentRelations.detailTitle} description={t.documentRelations.detailSubtitle} />
        <ApiErrorAlert
          error={detailQuery.error}
          title={t.table.errorTitle}
          description={documentRelationErrorMessage('load', detailQuery.error)}
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  const relation = detailQuery.data;

  const handleDelete = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => navigate('/app/documents/relations'),
    });
  };

  return (
    <div className="space-y-6" data-testid="document-relation-detail-page">
      <FormPageHeader
        title={kindLabel(relation.relationKind)}
        description={t.documentRelations.detailSubtitle}
        actions={
          <PermissionGate permission={PERMISSIONS.documents.relationDelete}>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              data-testid="document-relation-delete-button"
            >
              {t.documentRelations.delete}
            </Button>
          </PermissionGate>
        }
      />

      <Card>
        <CardContent>
          <DefinitionList>
            <Definition label={t.documentRelations.relationKind}>
              <Badge variant="neutral">{kindLabel(relation.relationKind)}</Badge>
            </Definition>
            <Definition label={t.documentRelations.quantity}>
              <span dir="ltr" className="num">
                {relation.quantity ?? t.documentRelations.noQuantity}
              </span>
            </Definition>
            <Definition label={t.documentRelations.createdAt}>
              <span dir="ltr">{formatInstant(relation.createdAt, timeZone)}</span>
            </Definition>
            <Definition label={t.documentRelations.createdByProcess}>
              {relation.createdByProcess ? t.app.yes : t.app.no}
            </Definition>
          </DefinitionList>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="text-sm font-semibold mb-3">{t.documentRelations.source}</h3>
          <DefinitionList>
            <Definition label={t.documentRelations.module}>
              <span dir="ltr">{relation.source.module}</span>
            </Definition>
            <Definition label={t.documentRelations.documentType}>
              <span dir="ltr" className="code">
                {relation.source.documentType}
              </span>
            </Definition>
            <Definition label={t.documentRelations.documentId}>
              <span dir="ltr" className="code text-xs">
                {relation.source.documentId}
              </span>
            </Definition>
            <Definition label={t.documentRelations.lineId}>
              <span dir="ltr" className="code text-xs">
                {relation.source.lineId ?? '—'}
              </span>
            </Definition>
          </DefinitionList>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="text-sm font-semibold mb-3">{t.documentRelations.target}</h3>
          <DefinitionList>
            <Definition label={t.documentRelations.module}>
              <span dir="ltr">{relation.target.module}</span>
            </Definition>
            <Definition label={t.documentRelations.documentType}>
              <span dir="ltr" className="code">
                {relation.target.documentType}
              </span>
            </Definition>
            <Definition label={t.documentRelations.documentId}>
              <span dir="ltr" className="code text-xs">
                {relation.target.documentId}
              </span>
            </Definition>
            <Definition label={t.documentRelations.lineId}>
              <span dir="ltr" className="code text-xs">
                {relation.target.lineId ?? '—'}
              </span>
            </Definition>
          </DefinitionList>
        </CardContent>
      </Card>

      <p className="text-xs text-ink-subtle" data-testid="document-relation-detail-note">
        {t.documentRelations.detailNote}
      </p>

      <ConfirmDialog
        open={confirmOpen}
        title={t.documentRelations.deleteTitle}
        description={t.documentRelations.deleteDescription}
        confirmLabel={t.documentRelations.deleteConfirm}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        loading={deleteMutation.isPending}
        loadingLabel={t.documentRelations.deleting}
        danger
        error={
          deleteMutation.isError ? documentRelationErrorMessage('delete', deleteMutation.error) : undefined
        }
      />
    </div>
  );
}
