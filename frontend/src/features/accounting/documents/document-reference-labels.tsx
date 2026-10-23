import type { ReactElement } from 'react';
import { t } from '@/lib/i18n';
import {
  useAccountReference,
  useBranchReference,
  useDetailRecordReference,
} from './use-document-detail';

/**
 * Reference labels of the document view: the API returns ids (a document line
 * carries `accountId`/`detailId`, the header `branchId`), and each label here
 * resolves its id through the real, permission-gated reference endpoint.
 *
 * While the reference loads the label is an ellipsis; when the session may
 * not read the reference (or it is gone) the label falls back to the raw id
 * in an LTR `code` span — the honest technical identifier, never a guessed
 * name and never a fake «—» that would hide which entity the line hit.
 */

function PendingLabel(): ReactElement {
  return <span className="text-ink-subtle">…</span>;
}

function FallbackIdLabel({ id }: { id: string }): ReactElement {
  return (
    <span className="code text-xs text-ink-subtle" title={id}>
      {id}
    </span>
  );
}

export function AccountLabel({
  organizationId,
  accountId,
}: {
  organizationId: string | null;
  accountId: string;
}): ReactElement {
  const query = useAccountReference(organizationId, accountId);
  const account = query.data;
  if (account === undefined) {
    return query.isPending ? (
      <PendingLabel />
    ) : (
      <FallbackIdLabel id={accountId} />
    );
  }
  return (
    <span>
      <span className="code">{account.code}</span>
      <span className="text-ink-subtle"> — {account.title}</span>
    </span>
  );
}

export function AccountCodeLabel({
  organizationId,
  accountId,
}: {
  organizationId: string | null;
  accountId: string;
}): ReactElement {
  const query = useAccountReference(organizationId, accountId);
  const account = query.data;
  if (account === undefined) {
    return query.isPending ? (
      <PendingLabel />
    ) : (
      <FallbackIdLabel id={accountId} />
    );
  }
  return <span className="code">{account.code}</span>;
}

export function DetailLabel({
  organizationId,
  detailId,
}: {
  organizationId: string | null;
  detailId: string;
}): ReactElement {
  const query = useDetailRecordReference(organizationId, detailId);
  const detail = query.data;
  if (detail === undefined) {
    return query.isPending ? (
      <PendingLabel />
    ) : (
      <FallbackIdLabel id={detailId} />
    );
  }
  return (
    <span className="text-xs text-ink-muted">
      <span className="code">{detail.code}</span> — {detail.title}
    </span>
  );
}

export function BranchLabel({
  organizationId,
  branchId,
}: {
  organizationId: string | null;
  branchId: string;
}): ReactElement {
  const query = useBranchReference(organizationId, branchId);
  const branch = query.data;
  if (branch === undefined) {
    return query.isPending ? (
      <PendingLabel />
    ) : (
      <FallbackIdLabel id={branchId} />
    );
  }
  return (
    <span>
      <span className="code">{branch.code}</span>
      <span className="text-ink-subtle"> — {branch.name}</span>
    </span>
  );
}

/** A generic reference row that is absent in the contract (null id). */
export function NoneLabel(): ReactElement {
  return <span className="text-ink-subtle">{t.app.none}</span>;
}
