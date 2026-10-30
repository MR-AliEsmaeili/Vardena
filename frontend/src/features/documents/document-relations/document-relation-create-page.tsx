import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { DOCUMENT_RELATION_KINDS } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { Select } from '@/ui/select';
import { documentRelationErrorMessage } from './document-relations-error-messages';
import { useCreateDocumentRelationMutation } from './use-document-relations';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function isValidUlid(v: string): boolean {
  return ULID_RE.test(v);
}

interface FieldErrors {
  sourceModule?: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  sourceLineId?: string;
  targetModule?: string;
  targetDocumentType?: string;
  targetDocumentId?: string;
  targetLineId?: string;
  relationKind?: string;
  quantity?: string;
}

/**
 * Create document relation (DOC-03).
 *
 * Form mirrors the exact backend contract: organizationId is taken from the
 * organization scope, not typed; source/target each have
 * module/documentType/documentId + optional lineId; relationKind is the
 * closed 6-value vocabulary; quantity is required iff fulfill else forbidden.
 */
export function DocumentRelationCreatePage() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const createMutation = useCreateDocumentRelationMutation(organizationId ?? 'none');

  const [relationKind, setRelationKind] = useState('reference');
  const [quantity, setQuantity] = useState('');
  const [sourceModule, setSourceModule] = useState('');
  const [sourceDocumentType, setSourceDocumentType] = useState('');
  const [sourceDocumentId, setSourceDocumentId] = useState('');
  const [sourceLineId, setSourceLineId] = useState('');
  const [targetModule, setTargetModule] = useState('');
  const [targetDocumentType, setTargetDocumentType] = useState('');
  const [targetDocumentId, setTargetDocumentId] = useState('');
  const [targetLineId, setTargetLineId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (sourceModule.trim() === '') next.sourceModule = t.documentRelations.validation.moduleRequired;
    else if (sourceModule.trim().length > 64) next.sourceModule = t.documentRelations.validation.moduleTooLong;
    if (sourceDocumentType.trim() === '') next.sourceDocumentType = t.documentRelations.validation.documentTypeRequired;
    else if (sourceDocumentType.trim().length > 64) next.sourceDocumentType = t.documentRelations.validation.documentTypeTooLong;
    if (!isValidUlid(sourceDocumentId.trim())) next.sourceDocumentId = t.documentRelations.validation.documentIdInvalid;
    if (sourceLineId.trim() !== '' && !isValidUlid(sourceLineId.trim())) next.sourceLineId = t.documentRelations.validation.lineIdInvalid;

    if (targetModule.trim() === '') next.targetModule = t.documentRelations.validation.moduleRequired;
    else if (targetModule.trim().length > 64) next.targetModule = t.documentRelations.validation.moduleTooLong;
    if (targetDocumentType.trim() === '') next.targetDocumentType = t.documentRelations.validation.documentTypeRequired;
    else if (targetDocumentType.trim().length > 64) next.targetDocumentType = t.documentRelations.validation.documentTypeTooLong;
    if (!isValidUlid(targetDocumentId.trim())) next.targetDocumentId = t.documentRelations.validation.documentIdInvalid;
    if (targetLineId.trim() !== '' && !isValidUlid(targetLineId.trim())) next.targetLineId = t.documentRelations.validation.lineIdInvalid;

    if (!DOCUMENT_RELATION_KINDS.includes(relationKind as never)) next.relationKind = t.documentRelations.validation.relationKindInvalid;

    const trimmedQty = quantity.trim();
    if (relationKind === 'fulfill') {
      if (trimmedQty === '') next.quantity = t.documentRelations.validation.quantityRequiredForFulfill;
      else if (!/^\d{1,14}(\.\d{1,4})?$/.test(trimmedQty)) next.quantity = t.documentRelations.validation.quantityInvalid;
    } else if (trimmedQty !== '') {
      next.quantity = t.documentRelations.validation.quantityForbidden;
    }

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (organizationId === null) return;
    if (!validate()) return;

    const trimmedQty = quantity.trim();
    createMutation.mutate(
      {
        organizationId,
        source: {
          module: sourceModule.trim(),
          documentType: sourceDocumentType.trim(),
          documentId: sourceDocumentId.trim(),
          ...(sourceLineId.trim() !== '' ? { lineId: sourceLineId.trim() } : {}),
        },
        target: {
          module: targetModule.trim(),
          documentType: targetDocumentType.trim(),
          documentId: targetDocumentId.trim(),
          ...(targetLineId.trim() !== '' ? { lineId: targetLineId.trim() } : {}),
        },
        relationKind,
        ...(trimmedQty !== '' ? { quantity: trimmedQty } : {}),
      },
      {
        onSuccess: (saved) => navigate(`/app/documents/relations/${encodeURIComponent(saved.id)}`),
      },
    );
  };

  const isFulfill = relationKind === 'fulfill';

  return (
    <div className="space-y-6" data-testid="document-relation-create-page">
      <FormPageHeader
        title={t.documentRelations.createTitle}
        description={t.documentRelations.createSubtitle}
        backTo="/app/documents/relations"
      />

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h3 className="text-sm font-semibold">{t.documentRelations.source}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sourceModule">{t.documentRelations.module}</Label>
                <Input
                  id="sourceModule"
                  value={sourceModule}
                  onChange={(ev) => setSourceModule(ev.target.value)}
                  placeholder="sales"
                  dir="ltr"
                  data-testid="document-relation-source-module"
                />
                {fieldErrors.sourceModule ? <p className="text-xs text-danger">{fieldErrors.sourceModule}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sourceDocumentType">{t.documentRelations.documentType}</Label>
                <Input
                  id="sourceDocumentType"
                  value={sourceDocumentType}
                  onChange={(ev) => setSourceDocumentType(ev.target.value)}
                  placeholder="sales_invoice"
                  dir="ltr"
                  data-testid="document-relation-source-document-type"
                />
                {fieldErrors.sourceDocumentType ? <p className="text-xs text-danger">{fieldErrors.sourceDocumentType}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sourceDocumentId">{t.documentRelations.documentId}</Label>
                <Input
                  id="sourceDocumentId"
                  value={sourceDocumentId}
                  onChange={(ev) => setSourceDocumentId(ev.target.value)}
                  placeholder="01ARZ3NDEKTSV4RRFFQ69G5FAV"
                  dir="ltr"
                  data-testid="document-relation-source-document-id"
                />
                {fieldErrors.sourceDocumentId ? <p className="text-xs text-danger">{fieldErrors.sourceDocumentId}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sourceLineId">{t.documentRelations.lineId} ({t.documentRelations.optional})</Label>
                <Input
                  id="sourceLineId"
                  value={sourceLineId}
                  onChange={(ev) => setSourceLineId(ev.target.value)}
                  placeholder="—"
                  dir="ltr"
                  data-testid="document-relation-source-line-id"
                />
                {fieldErrors.sourceLineId ? <p className="text-xs text-danger">{fieldErrors.sourceLineId}</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <h3 className="text-sm font-semibold">{t.documentRelations.target}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="targetModule">{t.documentRelations.module}</Label>
                <Input
                  id="targetModule"
                  value={targetModule}
                  onChange={(ev) => setTargetModule(ev.target.value)}
                  placeholder="accounting"
                  dir="ltr"
                  data-testid="document-relation-target-module"
                />
                {fieldErrors.targetModule ? <p className="text-xs text-danger">{fieldErrors.targetModule}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="targetDocumentType">{t.documentRelations.documentType}</Label>
                <Input
                  id="targetDocumentType"
                  value={targetDocumentType}
                  onChange={(ev) => setTargetDocumentType(ev.target.value)}
                  placeholder="accounting_journal"
                  dir="ltr"
                  data-testid="document-relation-target-document-type"
                />
                {fieldErrors.targetDocumentType ? <p className="text-xs text-danger">{fieldErrors.targetDocumentType}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="targetDocumentId">{t.documentRelations.documentId}</Label>
                <Input
                  id="targetDocumentId"
                  value={targetDocumentId}
                  onChange={(ev) => setTargetDocumentId(ev.target.value)}
                  placeholder="01ARZ3NDEKTSV4RRFFQ69G5FAV"
                  dir="ltr"
                  data-testid="document-relation-target-document-id"
                />
                {fieldErrors.targetDocumentId ? <p className="text-xs text-danger">{fieldErrors.targetDocumentId}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="targetLineId">{t.documentRelations.lineId} ({t.documentRelations.optional})</Label>
                <Input
                  id="targetLineId"
                  value={targetLineId}
                  onChange={(ev) => setTargetLineId(ev.target.value)}
                  placeholder="—"
                  dir="ltr"
                  data-testid="document-relation-target-line-id"
                />
                {fieldErrors.targetLineId ? <p className="text-xs text-danger">{fieldErrors.targetLineId}</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="relationKind">{t.documentRelations.relationKind}</Label>
                <Select
                  id="relationKind"
                  value={relationKind}
                  onChange={(ev) => setRelationKind((ev.target as HTMLSelectElement).value)}
                  data-testid="document-relation-kind"
                >
                  {DOCUMENT_RELATION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k === 'transfer_of'
                        ? t.documentRelations.kinds.transferOf
                        : t.documentRelations.kinds[k as keyof typeof t.documentRelations.kinds] ?? k}
                    </option>
                  ))}
                </Select>
                {fieldErrors.relationKind ? <p className="text-xs text-danger">{fieldErrors.relationKind}</p> : null}
                <p className="text-xs text-ink-subtle">{t.documentRelations.relationKindHint}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quantity">
                  {t.documentRelations.quantity}
                  {isFulfill ? ' *' : ` (${t.documentRelations.optional})`}
                </Label>
                <Input
                  id="quantity"
                  value={quantity}
                  onChange={(ev) => setQuantity(ev.target.value)}
                  placeholder={isFulfill ? '12.5000' : t.documentRelations.quantityPlaceholder}
                  dir="ltr"
                  data-testid="document-relation-quantity"
                  aria-describedby="quantity-hint"
                />
                {fieldErrors.quantity ? <p className="text-xs text-danger">{fieldErrors.quantity}</p> : null}
                <p id="quantity-hint" className="text-xs text-ink-subtle">
                  {isFulfill ? t.documentRelations.quantityFulfillHint : t.documentRelations.quantityForbiddenHint}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {createMutation.isError ? (
          <ApiErrorAlert
            error={createMutation.error}
            title={t.table.errorTitle}
            description={documentRelationErrorMessage('create', createMutation.error)}
          />
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/app/documents/relations')}>
            {t.app.cancel}
          </Button>
          <Button type="submit" disabled={createMutation.isPending} data-testid="document-relation-submit">
            {createMutation.isPending ? t.documentRelations.creating : t.documentRelations.create}
          </Button>
        </div>
      </form>
    </div>
  );
}
