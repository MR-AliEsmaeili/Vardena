import { Link, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { DocumentTypeConfigurationForm } from './document-type-configuration-form';
import { documentTypeErrorMessage } from './document-type-error-messages';
import {
  documentTypePhasesLabel,
  documentTypeStatesLabel,
} from './document-type-labels';
import { useDocumentType } from './use-document-types';
import { DOCUMENT_TYPES_PATH } from './document-types-page';

/**
 * One registered document type (DOC-01).
 *
 * Everything on this page is read from `GET /documents/types/:code`: the
 * registry metadata (immutable in the UI) and the organization's
 * `draftRequired`/`configured` flags. There is no edit route: the single
 * writable field lives in the configuration form on this same page, whose
 * `PUT` is idempotent and reads nothing that this page has not already read.
 */
export function DocumentTypeDetailPage() {
  const organizationId = useOrganizationId();
  const { code } = useParams<{ code: string }>();
  const query = useDocumentType(organizationId, code);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={6} label={t.loading.receiving} />;
  }

  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.documentTypes.detailTitle} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={documentTypeErrorMessage('load', query.error)}
          onRetry={() => void query.refetch()}
        />
        <Button asChild variant="outline">
          <Link to={DOCUMENT_TYPES_PATH}>{t.documentTypes.backToList}</Link>
        </Button>
      </div>
    );
  }

  const documentType = query.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t.documentTypes.detailTitle} — ${documentType.code}`}
        description={t.documentTypes.subtitle}
      />
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to={DOCUMENT_TYPES_PATH}>{t.documentTypes.backToList}</Link>
        </Button>
      </div>

      <DefinitionList>
        <Definition label={t.documentTypes.code}>
          <span className="code" dir="ltr" data-testid="document-type-code">
            {documentType.code}
          </span>
        </Definition>
        <Definition label={t.documentTypes.module}>
          <span dir="ltr">{documentType.module}</span>
        </Definition>
        <Definition label={t.documentTypes.name}>
          {documentType.name}
        </Definition>
        <Definition label={t.documentTypes.description}>
          {documentType.description ?? t.documentTypes.noDescription}
        </Definition>
        <Definition label={t.documentTypes.draftCapable}>
          <Badge variant={documentType.draftCapable ? 'success' : 'neutral'}>
            {documentType.draftCapable
              ? t.app.yes
              : t.documentTypes.draftNotCapable}
          </Badge>
        </Definition>
        <Definition label={t.documentTypes.draftRequired}>
          <span data-testid="document-type-draft-required-value">
            {documentType.draftRequired ? t.app.yes : t.app.no}
          </span>
        </Definition>
        <Definition label={t.documentTypes.entryStates}>
          {documentTypeStatesLabel(documentType.entryStates)}
        </Definition>
        <Definition label={t.documentTypes.deletablePhases}>
          {documentTypePhasesLabel(documentType.deletablePhases)}
        </Definition>
        <Definition label={t.documentTypes.configuration}>
          <Badge variant={documentType.configured ? 'info' : 'neutral'}>
            {documentType.configured
              ? t.documentTypes.configured
              : t.documentTypes.notConfigured}
          </Badge>
        </Definition>
      </DefinitionList>

      <Card>
        <CardContent>
          <DocumentTypeConfigurationForm
            organizationId={organizationId}
            documentType={documentType}
          />
        </CardContent>
      </Card>
    </div>
  );
}
