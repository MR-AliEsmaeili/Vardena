import {
  AlertTriangle,
  Clipboard,
  Download,
  History,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type {
  ClientDevice,
  DeviceReplacement,
  DeviceReplacementRequestExport,
} from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/ui/table';
import { PageHeader } from '@/ui/patterns/page-header';
import { deviceLifecycleErrorMessage } from './device-lifecycle-errors';
import {
  useActivateEnrollmentMutation,
  useCancelReplacementMutation,
  useClientDeviceHistory,
  useClientDeviceInventory,
  useCreateEnrollmentChallengeMutation,
  useCreateReplacementChallengeMutation,
  useDeactivateDeviceMutation,
  useExportReplacementRequestMutation,
  useImportReplacementResponseMutation,
  useProveReplacementMutation,
} from './use-client-devices';

const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
/** Mirrors ImportDeviceReplacementResponseDto.MaxLength; server verifies too. */
const DEVICE_RESPONSE_MAX_LENGTH = 65_536;

type Confirmation =
  | { kind: 'deactivate'; device: ClientDevice }
  | { kind: 'cancel-replacement'; replacement: DeviceReplacement }
  | null;

function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function statusLabel(status: ClientDevice['status']): string {
  switch (status) {
    case 'ACTIVE':
      return t.deviceLicensing.statusActive;
    case 'DEACTIVATED':
      return t.deviceLicensing.statusDeactivated;
    case 'REPLACED':
      return t.deviceLicensing.statusReplaced;
  }
}

function replacementStateLabel(state: DeviceReplacement['state']): string {
  switch (state) {
    case 'CHALLENGE':
      return t.deviceLicensing.stateChallenge;
    case 'PENDING':
      return t.deviceLicensing.statePending;
    case 'COMPLETED':
      return t.deviceLicensing.stateCompleted;
    case 'CANCELLED':
      return t.deviceLicensing.stateCancelled;
    case 'EXPIRED':
      return t.deviceLicensing.stateExpired;
  }
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'APPLIED':
      return t.deviceLicensing.outcomeApplied;
    case 'REJECTED':
      return t.deviceLicensing.outcomeRejected;
    case 'UNCHANGED':
      return t.deviceLicensing.outcomeUnchanged;
    default:
      return outcome;
  }
}

function statusVariant(
  status: ClientDevice['status'],
): 'success' | 'neutral' | 'info' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'REPLACED') return 'info';
  return 'neutral';
}

/**
 * Integrated Persian RTL administration surface for the retained device
 * lifecycle. All limits and states come from the API; browser permissions are
 * presentational only and every action is independently authorized by Nest.
 * Private device keys are never requested, generated, or persisted here.
 */
export function ClientDevicesPage() {
  const permissions = usePermissions();
  const inventory = useClientDeviceInventory();
  const createEnrollment = useCreateEnrollmentChallengeMutation();
  const activateEnrollment = useActivateEnrollmentMutation();
  const deactivate = useDeactivateDeviceMutation();
  const createReplacement = useCreateReplacementChallengeMutation();
  const proveReplacement = useProveReplacementMutation();
  const exportReplacement = useExportReplacementRequestMutation();
  const importResponse = useImportReplacementResponseMutation();
  const cancelReplacement = useCancelReplacementMutation();

  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollmentPublicKey, setEnrollmentPublicKey] = useState('');
  const [enrollmentSignature, setEnrollmentSignature] = useState('');
  const [enrollmentChallenge, setEnrollmentChallenge] = useState<{
    challengeId: string;
    canonicalPayload: string;
    expiresAt: string;
    keyFingerprint: string;
  } | null>(null);
  const [enrollmentSuccess, setEnrollmentSuccess] = useState(false);

  const [historyDeviceId, setHistoryDeviceId] = useState<string | null>(null);
  const [replacementDeviceId, setReplacementDeviceId] = useState<string | null>(
    null,
  );
  const [replacementPublicKey, setReplacementPublicKey] = useState('');
  const [replacementSignature, setReplacementSignature] = useState('');
  const [replacementChallenge, setReplacementChallenge] = useState<{
    requestId: string;
    canonicalPayload: string;
    challengeExpiresAt: string;
    keyFingerprint: string;
  } | null>(null);
  const [replacementExportArtifact, setReplacementExportArtifact] =
    useState<DeviceReplacementRequestExport | null>(null);

  const [responseDocument, setResponseDocument] = useState('');
  const [responseFileName, setResponseFileName] = useState('');
  const [responseInputError, setResponseInputError] = useState<string | null>(
    null,
  );
  const [responseSuccess, setResponseSuccess] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const canActivate = permissions.has(PERMISSIONS.licensing.deviceActivate);
  const canDeactivate = permissions.has(PERMISSIONS.licensing.deviceDeactivate);
  const canReplace = permissions.has(PERMISSIONS.licensing.deviceReplace);
  const canCancelReplacement = permissions.has(
    PERMISSIONS.licensing.deviceCancelReplacement,
  );
  const canCompleteReplacement = permissions.has(
    PERMISSIONS.licensing.deviceCompleteReplacement,
  );
  const data = inventory.data;
  const licenseCanAllocate =
    data?.licenseActive === true && data.deviceLimitSpecified;

  const selectedHistory = useClientDeviceHistory(historyDeviceId);

  function showOperationError(
    error: unknown,
    operation:
      | 'enrollment'
      | 'activation'
      | 'deactivation'
      | 'replacement'
      | 'replacement-proof'
      | 'replacement-export'
      | 'replacement-import'
      | 'replacement-cancel',
  ): string {
    return deviceLifecycleErrorMessage(error, operation).message;
  }

  function handleEnrollmentChallenge(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setEnrollmentSuccess(false);
    const publicKey = enrollmentPublicKey.trim();
    if (!PUBLIC_KEY_PATTERN.test(publicKey)) return;
    createEnrollment.mutate(
      { publicKey },
      {
        onSuccess: (challenge) => {
          setEnrollmentChallenge(challenge);
          setEnrollmentSignature('');
          setCopyMessage(null);
        },
      },
    );
  }

  function handleActivateEnrollment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (enrollmentChallenge === null) return;
    const signature = enrollmentSignature.trim();
    if (!SIGNATURE_PATTERN.test(signature)) return;
    activateEnrollment.mutate(
      {
        challengeId: enrollmentChallenge.challengeId,
        request: { signature },
      },
      {
        onSuccess: () => {
          setEnrollmentChallenge(null);
          setEnrollmentPublicKey('');
          setEnrollmentSignature('');
          setEnrollmentOpen(false);
          setEnrollmentSuccess(true);
        },
      },
    );
  }

  function handleReplacementChallenge(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (replacementDeviceId === null) return;
    const publicKey = replacementPublicKey.trim();
    if (!PUBLIC_KEY_PATTERN.test(publicKey)) return;
    setReplacementExportArtifact(null);
    createReplacement.mutate(
      { oldDeviceId: replacementDeviceId, request: { publicKey } },
      {
        onSuccess: (challenge) => {
          setReplacementChallenge(challenge);
          setReplacementSignature('');
          setCopyMessage(null);
        },
      },
    );
  }

  function handleProveReplacement(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (replacementChallenge === null) return;
    const signature = replacementSignature.trim();
    if (!SIGNATURE_PATTERN.test(signature)) return;
    proveReplacement.mutate(
      {
        requestId: replacementChallenge.requestId,
        request: { signature },
      },
      {
        onSuccess: (artifact) => {
          setReplacementExportArtifact(artifact);
          setReplacementChallenge(null);
          setReplacementSignature('');
          setReplacementPublicKey('');
        },
      },
    );
  }

  function handleImportResponse(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setResponseInputError(null);
    setResponseSuccess(false);
    if (responseDocument.trim() === '') {
      setResponseInputError(t.deviceLicensing.responseRequired);
      return;
    }
    if (responseDocument.length > DEVICE_RESPONSE_MAX_LENGTH) {
      setResponseInputError(t.deviceLicensing.responseTooLong);
      return;
    }
    importResponse.mutate(
      { document: responseDocument },
      {
        onSuccess: () => {
          setResponseDocument('');
          setResponseFileName('');
          setResponseSuccess(true);
        },
      },
    );
  }

  async function handleResponseFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setResponseInputError(null);
    if (file.size > DEVICE_RESPONSE_MAX_LENGTH) {
      setResponseInputError(t.deviceLicensing.responseTooLong);
      return;
    }
    try {
      const content = await file.text();
      if (content.length > DEVICE_RESPONSE_MAX_LENGTH) {
        setResponseInputError(t.deviceLicensing.responseTooLong);
        return;
      }
      setResponseDocument(content);
      setResponseFileName(file.name);
    } catch {
      setResponseInputError(t.deviceLicensing.responseReadFailed);
    }
  }

  async function copyArtifact(value: string): Promise<void> {
    if (typeof navigator.clipboard?.writeText !== 'function') {
      setCopyMessage(t.deviceLicensing.clipboardUnavailable);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(t.deviceLicensing.artifactCopied);
    } catch {
      setCopyMessage(t.deviceLicensing.copyFailed);
    }
  }

  function openReplacement(device: ClientDevice): void {
    setReplacementDeviceId(device.id);
    setReplacementChallenge(null);
    setReplacementExportArtifact(null);
    setReplacementPublicKey('');
    setReplacementSignature('');
    setCopyMessage(null);
  }

  function confirmCurrentAction(): void {
    if (confirmation === null) return;
    if (confirmation.kind === 'deactivate') {
      deactivate.mutate(
        { deviceId: confirmation.device.id },
        { onSuccess: () => setConfirmation(null) },
      );
      return;
    }
    cancelReplacement.mutate(
      { requestId: confirmation.replacement.id },
      {
        onSuccess: () => {
          setConfirmation(null);
          setCancelSuccess(true);
        },
      },
    );
  }

  const confirmationError =
    confirmation?.kind === 'deactivate' && deactivate.isError
      ? showOperationError(deactivate.error, 'deactivation')
      : confirmation?.kind === 'cancel-replacement' && cancelReplacement.isError
        ? showOperationError(cancelReplacement.error, 'replacement-cancel')
        : undefined;
  const confirmationLoading =
    confirmation?.kind === 'deactivate'
      ? deactivate.isPending
      : confirmation?.kind === 'cancel-replacement'
        ? cancelReplacement.isPending
        : false;
  const confirmationTitle =
    confirmation?.kind === 'deactivate'
      ? t.deviceLicensing.deactivateTitle
      : t.deviceLicensing.cancelReplacementTitle;
  const confirmationDescription =
    confirmation?.kind === 'deactivate'
      ? t.deviceLicensing.deactivateDescription
      : t.deviceLicensing.cancelReplacementDescription;
  const confirmationLabel =
    confirmation?.kind === 'deactivate'
      ? t.deviceLicensing.confirmDeactivate
      : t.deviceLicensing.confirmCancelReplacement;
  const confirmationLoadingLabel =
    confirmation?.kind === 'deactivate'
      ? t.deviceLicensing.deactivating
      : t.deviceLicensing.cancellingReplacement;

  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader
        title={t.deviceLicensing.title}
        description={t.deviceLicensing.subtitle}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void inventory.refetch()}
              disabled={inventory.isFetching}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t.deviceLicensing.refresh}
            </Button>
            {canActivate && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setEnrollmentOpen((open) => !open);
                  setEnrollmentSuccess(false);
                }}
                disabled={!licenseCanAllocate || createEnrollment.isPending}
              >
                <Smartphone className="h-4 w-4" aria-hidden />
                {t.deviceLicensing.enroll}
              </Button>
            )}
          </>
        }
      />

      <Alert variant="info">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <AlertBody>{t.deviceLicensing.securityNote}</AlertBody>
        </div>
      </Alert>

      {inventory.isLoading ? (
        <LoadingState label={t.deviceLicensing.loading} rows={5} />
      ) : inventory.isError ? (
        <Alert variant="danger" role="alert">
          <AlertTitle>{t.errors.title}</AlertTitle>
          <AlertBody>
            {deviceLifecycleErrorMessage(inventory.error, 'load').message}
            {deviceLifecycleErrorMessage(inventory.error, 'load')
              .correlationId && (
              <span className="mt-1 block text-xs" dir="ltr">
                {
                  deviceLifecycleErrorMessage(inventory.error, 'load')
                    .correlationId
                }
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void inventory.refetch()}
            >
              {t.app.retry}
            </Button>
          </AlertBody>
        </Alert>
      ) : data === undefined ? null : (
        <>
          {!data.licenseActive && (
            <Alert variant="warning">
              <AlertTitle>{t.deviceLicensing.licenseInactive}</AlertTitle>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t.deviceLicensing.quota}</CardTitle>
              <CardDescription>
                <span className="code" dir="ltr">
                  {data.installationId}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <QuotaStat
                label={t.deviceLicensing.activeCount}
                value={String(data.activeDeviceCount)}
              />
              <QuotaStat
                label={t.deviceLicensing.quota}
                value={
                  !data.deviceLimitSpecified
                    ? t.deviceLicensing.quotaUnspecified
                    : data.deviceLimit === null
                      ? t.deviceLicensing.quotaUnlimited
                      : t.deviceLicensing.quotaFinite
                          .replace('{active}', String(data.activeDeviceCount))
                          .replace('{limit}', String(data.deviceLimit))
                }
              />
              <QuotaStat
                label={t.deviceLicensing.availableSlots}
                value={
                  !data.deviceLimitSpecified
                    ? t.deviceLicensing.quotaUnspecified
                    : data.availableDeviceSlots === null
                      ? t.deviceLicensing.quotaUnlimited
                      : String(data.availableDeviceSlots)
                }
              />
            </CardContent>
          </Card>

          {enrollmentSuccess && (
            <Alert variant="success">
              <AlertBody>{t.deviceLicensing.enrollmentSuccess}</AlertBody>
            </Alert>
          )}
          {deactivate.isSuccess && confirmation === null && (
            <Alert variant="success">
              <AlertBody>{t.deviceLicensing.deactivateSuccess}</AlertBody>
            </Alert>
          )}
          {responseSuccess && (
            <Alert variant="success">
              <AlertBody>{t.deviceLicensing.importResponseSuccess}</AlertBody>
            </Alert>
          )}
          {cancelSuccess && (
            <Alert variant="success">
              <AlertBody>
                {t.deviceLicensing.cancelReplacementSuccess}
              </AlertBody>
            </Alert>
          )}

          {enrollmentOpen && canActivate && (
            <EnrollmentPanel
              publicKey={enrollmentPublicKey}
              signature={enrollmentSignature}
              challenge={enrollmentChallenge}
              createPending={createEnrollment.isPending}
              activatePending={activateEnrollment.isPending}
              createError={
                createEnrollment.isError
                  ? showOperationError(createEnrollment.error, 'enrollment')
                  : undefined
              }
              activateError={
                activateEnrollment.isError
                  ? showOperationError(activateEnrollment.error, 'activation')
                  : undefined
              }
              copyMessage={copyMessage}
              onPublicKeyChange={setEnrollmentPublicKey}
              onSignatureChange={setEnrollmentSignature}
              onCreate={handleEnrollmentChallenge}
              onActivate={handleActivateEnrollment}
              onCopy={() => {
                if (enrollmentChallenge !== null) {
                  void copyArtifact(enrollmentChallenge.canonicalPayload);
                }
              }}
              onDownload={() => {
                if (enrollmentChallenge !== null) {
                  downloadTextFile(
                    `device-enrollment-${enrollmentChallenge.challengeId}.json`,
                    enrollmentChallenge.canonicalPayload,
                    'application/json',
                  );
                }
              }}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t.deviceLicensing.deviceInventory}</CardTitle>
              <CardDescription>
                {t.deviceLicensing.noDevicesBody}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.devices.length === 0 ? (
                <EmptyState
                  title={t.deviceLicensing.noDevicesTitle}
                  description={t.deviceLicensing.noDevicesBody}
                />
              ) : (
                <TableWrapper>
                  <Table aria-label={t.deviceLicensing.deviceInventory}>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>
                          {t.deviceLicensing.deviceId}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.keyFingerprint}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.deviceStatus}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.activatedAt}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.actions}
                        </TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.devices.map((device) => (
                        <TableRow key={device.id}>
                          <TableCell>
                            <span className="code" dir="ltr">
                              {device.id}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="code break-all" dir="ltr">
                              {device.keyFingerprint}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(device.status)}>
                              {statusLabel(device.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="num" dir="ltr">
                              {formatDateTime(device.activatedAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label={`${t.deviceLicensing.history}: ${device.id}`}
                                onClick={() =>
                                  setHistoryDeviceId((current) =>
                                    current === device.id ? null : device.id,
                                  )
                                }
                              >
                                <History className="h-4 w-4" aria-hidden />
                                {historyDeviceId === device.id
                                  ? t.deviceLicensing.hideHistory
                                  : t.deviceLicensing.history}
                              </Button>
                              {device.status === 'ACTIVE' && canDeactivate && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="danger"
                                  onClick={() => {
                                    deactivate.reset();
                                    setConfirmation({
                                      kind: 'deactivate',
                                      device,
                                    });
                                  }}
                                >
                                  {t.deviceLicensing.deactivate}
                                </Button>
                              )}
                              {device.status === 'ACTIVE' && canReplace && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!licenseCanAllocate}
                                  onClick={() => openReplacement(device)}
                                >
                                  {t.deviceLicensing.replace}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrapper>
              )}
            </CardContent>
          </Card>

          {historyDeviceId !== null && (
            <Card>
              <CardHeader>
                <CardTitle>{t.deviceLicensing.history}</CardTitle>
                <CardDescription>
                  <span className="code" dir="ltr">
                    {historyDeviceId}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedHistory.isLoading ? (
                  <LoadingState rows={3} />
                ) : selectedHistory.isError ? (
                  <Alert variant="danger" role="alert">
                    <AlertBody>
                      {
                        deviceLifecycleErrorMessage(
                          selectedHistory.error,
                          'load',
                        ).message
                      }
                    </AlertBody>
                  </Alert>
                ) : selectedHistory.data?.events.length === 0 ? (
                  <EmptyState
                    title={t.deviceLicensing.history}
                    description={t.deviceLicensing.historyEmpty}
                  />
                ) : (
                  <TableWrapper>
                    <Table aria-label={t.deviceLicensing.history}>
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>
                            {t.deviceLicensing.event}
                          </TableHeaderCell>
                          <TableHeaderCell>
                            {t.deviceLicensing.eventOutcome}
                          </TableHeaderCell>
                          <TableHeaderCell>
                            {t.deviceLicensing.eventTime}
                          </TableHeaderCell>
                          <TableHeaderCell>
                            {t.deviceLicensing.auditReason}
                          </TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedHistory.data?.events.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell>
                              <span className="code" dir="ltr">
                                {event.eventType}
                              </span>
                            </TableCell>
                            <TableCell>{outcomeLabel(event.outcome)}</TableCell>
                            <TableCell>
                              <span className="num" dir="ltr">
                                {formatDateTime(event.occurredAt)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="code" dir="ltr">
                                {event.reason ?? t.app.none}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableWrapper>
                )}
              </CardContent>
            </Card>
          )}

          {replacementDeviceId !== null && canReplace && (
            <ReplacementPanel
              deviceId={replacementDeviceId}
              publicKey={replacementPublicKey}
              signature={replacementSignature}
              challenge={replacementChallenge}
              artifact={replacementExportArtifact}
              createPending={createReplacement.isPending}
              provePending={proveReplacement.isPending}
              createError={
                createReplacement.isError
                  ? showOperationError(createReplacement.error, 'replacement')
                  : undefined
              }
              proveError={
                proveReplacement.isError
                  ? showOperationError(
                      proveReplacement.error,
                      'replacement-proof',
                    )
                  : undefined
              }
              copyMessage={copyMessage}
              onPublicKeyChange={setReplacementPublicKey}
              onSignatureChange={setReplacementSignature}
              onCreate={handleReplacementChallenge}
              onProve={handleProveReplacement}
              onCopyChallenge={() => {
                if (replacementChallenge !== null) {
                  void copyArtifact(replacementChallenge.canonicalPayload);
                }
              }}
              onDownloadChallenge={() => {
                if (replacementChallenge !== null) {
                  downloadTextFile(
                    `device-replacement-${replacementChallenge.requestId}-challenge.json`,
                    replacementChallenge.canonicalPayload,
                    'application/json',
                  );
                }
              }}
              onCopy={() => {
                if (replacementExportArtifact !== null) {
                  void copyArtifact(replacementExportArtifact.text);
                }
              }}
              onDownload={() => {
                if (replacementExportArtifact !== null) {
                  downloadTextFile(
                    `vardena-device-replacement-${replacementExportArtifact.requestId}.json`,
                    replacementExportArtifact.file,
                    'application/json',
                  );
                }
              }}
              onClose={() => {
                setReplacementDeviceId(null);
                setReplacementChallenge(null);
                setReplacementExportArtifact(null);
                setReplacementSignature('');
                setReplacementPublicKey('');
              }}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t.deviceLicensing.pendingReplacements}</CardTitle>
              <CardDescription>
                {t.deviceLicensing.replacementDescription}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.replacements.length === 0 ? (
                <EmptyState
                  title={t.deviceLicensing.pendingReplacements}
                  description={t.deviceLicensing.noReplacements}
                />
              ) : (
                <TableWrapper>
                  <Table aria-label={t.deviceLicensing.pendingReplacements}>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>
                          {t.deviceLicensing.requestId}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.replacementDevices}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.keyFingerprint}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.replacementState}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.replacementExpires}
                        </TableHeaderCell>
                        <TableHeaderCell>
                          {t.deviceLicensing.actions}
                        </TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.replacements.map((replacement) => (
                        <TableRow key={replacement.id}>
                          <TableCell>
                            <span className="code" dir="ltr">
                              {replacement.id}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div
                              className="space-y-1 font-mono text-xs"
                              dir="ltr"
                            >
                              <span className="block">
                                {replacement.oldDeviceId}
                              </span>
                              <span
                                className="block text-center"
                                aria-hidden="true"
                              >
                                →
                              </span>
                              <span className="block">
                                {replacement.newDeviceId}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="code" dir="ltr">
                              {replacement.keyFingerprint}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                replacement.state === 'PENDING'
                                  ? 'warning'
                                  : replacement.state === 'COMPLETED'
                                    ? 'success'
                                    : 'neutral'
                              }
                            >
                              {replacementStateLabel(replacement.state)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="num" dir="ltr">
                              {formatDateTime(replacement.requestExpiresAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {replacement.state === 'PENDING' &&
                                canReplace && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      exportReplacement.reset();
                                      exportReplacement.mutate(
                                        { requestId: replacement.id },
                                        {
                                          onSuccess:
                                            setReplacementExportArtifact,
                                        },
                                      );
                                    }}
                                    disabled={exportReplacement.isPending}
                                  >
                                    <Download className="h-4 w-4" aria-hidden />
                                    {t.deviceLicensing.downloadRequest}
                                  </Button>
                                )}
                              {(replacement.state === 'CHALLENGE' ||
                                replacement.state === 'PENDING') &&
                                canCancelReplacement && (
                                  <Button
                                    type="button"
                                    variant="danger"
                                    size="sm"
                                    onClick={() => {
                                      cancelReplacement.reset();
                                      setCancelSuccess(false);
                                      setConfirmation({
                                        kind: 'cancel-replacement',
                                        replacement,
                                      });
                                    }}
                                  >
                                    {t.deviceLicensing.cancelReplacement}
                                  </Button>
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrapper>
              )}
              {exportReplacement.isError && (
                <Alert className="mt-3" variant="danger" role="alert">
                  <AlertBody>
                    {showOperationError(
                      exportReplacement.error,
                      'replacement-export',
                    )}
                  </AlertBody>
                </Alert>
              )}
              {replacementExportArtifact !== null && (
                <ArtifactPanel
                  title={t.deviceLicensing.replacementExport}
                  label={t.deviceLicensing.replacementText}
                  text={replacementExportArtifact.text}
                  hint={t.deviceLicensing.replacementExportHint}
                  downloadLabel={t.deviceLicensing.downloadRequest}
                  copyMessage={copyMessage}
                  onCopy={() =>
                    void copyArtifact(replacementExportArtifact.text)
                  }
                  onDownload={() =>
                    downloadTextFile(
                      `vardena-device-replacement-${replacementExportArtifact.requestId}.json`,
                      replacementExportArtifact.file,
                      'application/json',
                    )
                  }
                />
              )}
            </CardContent>
          </Card>

          {canCompleteReplacement && (
            <ResponseImportPanel
              document={responseDocument}
              fileName={responseFileName}
              inputError={responseInputError}
              mutationPending={importResponse.isPending}
              mutationError={
                importResponse.isError
                  ? showOperationError(
                      importResponse.error,
                      'replacement-import',
                    )
                  : undefined
              }
              onDocumentChange={(value) => {
                setResponseDocument(value);
                setResponseFileName('');
                setResponseInputError(null);
              }}
              onFileChange={(file) => void handleResponseFile(file)}
              onSubmit={handleImportResponse}
            />
          )}
        </>
      )}

      {confirmation !== null && (
        <ConfirmDialog
          open
          title={confirmationTitle}
          description={confirmationDescription}
          confirmLabel={confirmationLabel}
          loadingLabel={confirmationLoadingLabel}
          loading={confirmationLoading}
          error={confirmationError}
          danger
          onConfirm={confirmCurrentAction}
          onCancel={() => {
            if (!confirmationLoading) setConfirmation(null);
          }}
        />
      )}
    </div>
  );
}

function QuotaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-sunken px-3 py-3">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <Alert variant="danger" role="alert">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <AlertBody>{message}</AlertBody>
      </div>
    </Alert>
  );
}

function ArtifactPanel({
  title,
  label,
  text,
  hint,
  downloadLabel,
  copyMessage,
  onCopy,
  onDownload,
}: {
  title: string;
  label: string;
  text: string;
  hint: string;
  downloadLabel: string;
  copyMessage: string | null;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <section className="mt-4 space-y-2 rounded-md border border-brand/30 bg-indigo-50/40 p-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <Label htmlFor="device-artifact-text">{label}</Label>
      <textarea
        id="device-artifact-text"
        readOnly
        value={text}
        dir="ltr"
        spellCheck={false}
        className="min-h-28 w-full rounded-md border border-line-strong bg-surface p-3 font-mono text-xs text-ink"
      />
      <p className="text-xs leading-5 text-ink-muted">{hint}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          <Clipboard className="h-4 w-4" aria-hidden />
          {t.deviceLicensing.copyText}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDownload}>
          <Download className="h-4 w-4" aria-hidden />
          {downloadLabel}
        </Button>
      </div>
      {copyMessage !== null && (
        <output className="text-xs text-ink-muted">{copyMessage}</output>
      )}
    </section>
  );
}

function EnrollmentPanel({
  publicKey,
  signature,
  challenge,
  createPending,
  activatePending,
  createError,
  activateError,
  copyMessage,
  onPublicKeyChange,
  onSignatureChange,
  onCreate,
  onActivate,
  onCopy,
  onDownload,
}: {
  publicKey: string;
  signature: string;
  challenge: {
    challengeId: string;
    canonicalPayload: string;
    expiresAt: string;
    keyFingerprint: string;
  } | null;
  createPending: boolean;
  activatePending: boolean;
  createError: string | undefined;
  activateError: string | undefined;
  copyMessage: string | null;
  onPublicKeyChange: (value: string) => void;
  onSignatureChange: (value: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onActivate: (event: FormEvent<HTMLFormElement>) => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.deviceLicensing.enrollTitle}</CardTitle>
        <CardDescription>{t.deviceLicensing.enrollDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {challenge === null ? (
          <form className="space-y-3" onSubmit={onCreate}>
            <div className="space-y-1.5">
              <Label htmlFor="enrollment-public-key">
                {t.deviceLicensing.publicKey}
              </Label>
              <Input
                id="enrollment-public-key"
                value={publicKey}
                onChange={(event) => onPublicKeyChange(event.target.value)}
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                required
                pattern="[A-Za-z0-9_-]{1,256}"
                aria-describedby="enrollment-public-key-hint"
              />
              <p
                id="enrollment-public-key-hint"
                className="text-xs text-ink-subtle"
              >
                {t.deviceLicensing.publicKeyHint}
              </p>
            </div>
            {createError !== undefined && <InlineError message={createError} />}
            <Button type="submit" disabled={createPending}>
              {createPending
                ? t.deviceLicensing.creatingChallenge
                : t.deviceLicensing.createChallenge}
            </Button>
          </form>
        ) : (
          <>
            <div className="space-y-1.5">
              <p className="text-xs text-ink-muted">
                {t.deviceLicensing.challengeExpires}:{' '}
                <span className="num" dir="ltr">
                  {formatDateTime(challenge.expiresAt)}
                </span>
              </p>
              <p className="text-xs text-ink-muted">
                {t.deviceLicensing.keyFingerprint}:{' '}
                <span className="code" dir="ltr">
                  {challenge.keyFingerprint}
                </span>
              </p>
              <Label htmlFor="enrollment-canonical-payload">
                {t.deviceLicensing.challenge}
              </Label>
              <textarea
                id="enrollment-canonical-payload"
                readOnly
                value={challenge.canonicalPayload}
                dir="ltr"
                spellCheck={false}
                className="min-h-36 w-full rounded-md border border-line-strong bg-sunken p-3 font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCopy}
              >
                <Clipboard className="h-4 w-4" aria-hidden />
                {t.deviceLicensing.challengeCopy}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDownload}
              >
                <Download className="h-4 w-4" aria-hidden />
                {t.deviceLicensing.downloadChallenge}
              </Button>
            </div>
            {copyMessage !== null && (
              <output className="text-xs text-ink-muted">{copyMessage}</output>
            )}
            <form className="space-y-3" onSubmit={onActivate}>
              <div className="space-y-1.5">
                <Label htmlFor="enrollment-signature">
                  {t.deviceLicensing.signature}
                </Label>
                <Input
                  id="enrollment-signature"
                  value={signature}
                  onChange={(event) => onSignatureChange(event.target.value)}
                  maxLength={256}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  required
                  pattern="[A-Za-z0-9_-]{1,256}"
                  aria-describedby="enrollment-signature-hint"
                />
                <p
                  id="enrollment-signature-hint"
                  className="text-xs text-ink-subtle"
                >
                  {t.deviceLicensing.signatureHint}
                </p>
              </div>
              {activateError !== undefined && (
                <InlineError message={activateError} />
              )}
              <Button type="submit" disabled={activatePending}>
                {activatePending
                  ? t.deviceLicensing.activating
                  : t.deviceLicensing.activate}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReplacementPanel({
  deviceId,
  publicKey,
  signature,
  challenge,
  artifact,
  createPending,
  provePending,
  createError,
  proveError,
  copyMessage,
  onPublicKeyChange,
  onSignatureChange,
  onCreate,
  onProve,
  onCopyChallenge,
  onDownloadChallenge,
  onCopy,
  onDownload,
  onClose,
}: {
  deviceId: string;
  publicKey: string;
  signature: string;
  challenge: {
    requestId: string;
    canonicalPayload: string;
    challengeExpiresAt: string;
    keyFingerprint: string;
  } | null;
  artifact: DeviceReplacementRequestExport | null;
  createPending: boolean;
  provePending: boolean;
  createError: string | undefined;
  proveError: string | undefined;
  copyMessage: string | null;
  onPublicKeyChange: (value: string) => void;
  onSignatureChange: (value: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onProve: (event: FormEvent<HTMLFormElement>) => void;
  onCopyChallenge: () => void;
  onDownloadChallenge: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t.deviceLicensing.replacementTitle}</CardTitle>
            <CardDescription className="mt-1">
              {t.deviceLicensing.replacementDescription}
            </CardDescription>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t.app.close}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-ink-muted">
          {t.deviceLicensing.deviceId}:{' '}
          <span className="code" dir="ltr">
            {deviceId}
          </span>
        </p>
        {challenge === null && artifact === null ? (
          <form className="space-y-3" onSubmit={onCreate}>
            <div className="space-y-1.5">
              <Label htmlFor="replacement-public-key">
                {t.deviceLicensing.publicKey}
              </Label>
              <Input
                id="replacement-public-key"
                value={publicKey}
                onChange={(event) => onPublicKeyChange(event.target.value)}
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                required
                pattern="[A-Za-z0-9_-]{1,256}"
              />
              <p className="text-xs text-ink-subtle">
                {t.deviceLicensing.publicKeyHint}
              </p>
            </div>
            {createError !== undefined && <InlineError message={createError} />}
            <Button type="submit" disabled={createPending}>
              {createPending
                ? t.deviceLicensing.creatingReplacementChallenge
                : t.deviceLicensing.createReplacementChallenge}
            </Button>
          </form>
        ) : challenge !== null ? (
          <>
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">
                {t.deviceLicensing.replacementChallengeExpires}:{' '}
                <span className="num" dir="ltr">
                  {formatDateTime(challenge.challengeExpiresAt)}
                </span>
              </p>
              <p className="text-xs text-ink-muted">
                {t.deviceLicensing.keyFingerprint}:{' '}
                <span className="code" dir="ltr">
                  {challenge.keyFingerprint}
                </span>
              </p>
              <Label htmlFor="replacement-canonical-payload">
                {t.deviceLicensing.replacementChallenge}
              </Label>
              <textarea
                id="replacement-canonical-payload"
                readOnly
                value={challenge.canonicalPayload}
                dir="ltr"
                spellCheck={false}
                className="min-h-36 w-full rounded-md border border-line-strong bg-sunken p-3 font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCopyChallenge}
              >
                <Clipboard className="h-4 w-4" aria-hidden />
                {t.deviceLicensing.challengeCopy}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDownloadChallenge}
              >
                <Download className="h-4 w-4" aria-hidden />
                {t.deviceLicensing.downloadChallenge}
              </Button>
            </div>
            {copyMessage !== null && (
              <output className="text-xs text-ink-muted">{copyMessage}</output>
            )}
            <form className="space-y-3" onSubmit={onProve}>
              <div className="space-y-1.5">
                <Label htmlFor="replacement-signature">
                  {t.deviceLicensing.signature}
                </Label>
                <Input
                  id="replacement-signature"
                  value={signature}
                  onChange={(event) => onSignatureChange(event.target.value)}
                  maxLength={256}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  required
                  pattern="[A-Za-z0-9_-]{1,256}"
                />
                <p className="text-xs text-ink-subtle">
                  {t.deviceLicensing.signatureHint}
                </p>
              </div>
              {proveError !== undefined && <InlineError message={proveError} />}
              <Button type="submit" disabled={provePending}>
                {provePending
                  ? t.deviceLicensing.provingReplacement
                  : t.deviceLicensing.proveReplacement}
              </Button>
            </form>
          </>
        ) : null}
        {artifact !== null && (
          <ArtifactPanel
            title={t.deviceLicensing.replacementExport}
            label={t.deviceLicensing.replacementText}
            text={artifact.text}
            hint={t.deviceLicensing.replacementExportHint}
            downloadLabel={t.deviceLicensing.downloadRequest}
            copyMessage={copyMessage}
            onCopy={onCopy}
            onDownload={onDownload}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ResponseImportPanel({
  document: responseDocument,
  fileName,
  inputError,
  mutationPending,
  mutationError,
  onDocumentChange,
  onFileChange,
  onSubmit,
}: {
  document: string;
  fileName: string;
  inputError: string | null;
  mutationPending: boolean;
  mutationError: string | undefined;
  onDocumentChange: (value: string) => void;
  onFileChange: (file: File | undefined) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.deviceLicensing.importResponse}</CardTitle>
        <CardDescription>
          {t.deviceLicensing.importResponseHint}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="replacement-response-file">
              {t.deviceLicensing.responseFile}
            </Label>
            <Input
              id="replacement-response-file"
              type="file"
              accept=".json,.vdrp,.txt,application/json,text/plain"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                onFileChange(file);
              }}
            />
            {fileName !== '' && (
              <p className="text-xs text-ink-subtle" dir="ltr">
                {fileName}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="replacement-response-document">
              {t.deviceLicensing.responseDocument}
            </Label>
            <textarea
              id="replacement-response-document"
              value={responseDocument}
              onChange={(event) => onDocumentChange(event.target.value)}
              maxLength={DEVICE_RESPONSE_MAX_LENGTH}
              dir="ltr"
              spellCheck={false}
              className="min-h-36 w-full rounded-md border border-line-strong bg-surface p-3 font-mono text-xs"
            />
          </div>
          {inputError !== null && inputError !== undefined && (
            <InlineError message={inputError} />
          )}
          {mutationError !== undefined && (
            <InlineError message={mutationError} />
          )}
          <Button type="submit" disabled={mutationPending}>
            {mutationPending
              ? t.deviceLicensing.importingResponse
              : t.deviceLicensing.importResponseSubmit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
