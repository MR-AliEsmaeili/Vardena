/**
 * Per-window error boundary (spec §6.7, FDR-01 §3.3).
 *
 * A render-time crash in one window must not take down the shell, the dock
 * or the other windows: the boundary wraps each window's router subtree and
 * renders a localized fallback panel instead.
 *
 *  - «retry» REMOUNTS the window's subtree at its mount path via a key bump
 *    (fresh component state, fresh queries — no stale half-rendered tree);
 *  - «close» routes through `requestClose`, so a window that was dirty
 *    before the crash still gets the dirty confirmation (§4.7 — a crash is
 *    never a silent data-loss path);
 *  - `no-console` is an error in this repo, so nothing is logged here;
 *    React logs the caught error itself in development.
 */

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WindowId } from './workspace-reducer';

export interface WorkspaceErrorBoundaryProps {
  windowId: WindowId;
  /** Close request (dirty confirmation applies) — from the stable actions. */
  onRequestClose: (id: WindowId) => void;
  children: ReactNode;
}

interface WorkspaceErrorBoundaryState {
  hasError: boolean;
  /** Bumped on retry so the subtree remounts with fresh state. */
  attempt: number;
}

export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  override state: WorkspaceErrorBoundaryState = {
    hasError: false,
    attempt: 0,
  };

  static getDerivedStateFromError(): Partial<WorkspaceErrorBoundaryState> {
    return { hasError: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // React reports the error itself in development; `no-console` forbids
    // logging here and the fallback panel is the user-facing signal.
  }

  private readonly handleRetry = (): void => {
    this.setState((previous) => ({
      hasError: false,
      attempt: previous.attempt + 1,
    }));
  };

  private readonly handleClose = (): void => {
    this.props.onRequestClose(this.props.windowId);
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return (
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      );
    }
    return (
      <div
        role="alert"
        data-testid="workspace-window-error"
        className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface p-6 text-center shadow-card"
      >
        <p className="text-sm font-semibold text-ink">
          {t.workspace.panelErrorTitle}
        </p>
        <p className="max-w-prose text-xs leading-6 text-ink-muted">
          {t.workspace.panelErrorBody}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            data-testid="workspace-window-error-retry"
            onClick={this.handleRetry}
            className={cn(
              'action-press rounded-control border border-line bg-surface px-3 py-1.5',
              'text-xs font-medium text-ink transition-colors hover:bg-sunken',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            )}
          >
            {t.workspace.retryPanel}
          </button>
          <button
            type="button"
            data-testid="workspace-window-error-close"
            onClick={this.handleClose}
            className={cn(
              'action-press rounded-control bg-danger px-3 py-1.5 text-xs font-medium text-white',
              'transition-opacity hover:opacity-90',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger',
            )}
          >
            {t.workspace.closePanel}
          </button>
        </div>
      </div>
    );
  }
}
