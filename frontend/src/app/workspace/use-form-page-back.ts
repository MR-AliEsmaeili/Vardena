import { useCallback, useContext } from 'react';
import {
  UNSAFE_NavigationContext,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useWorkspace, useWorkspaceWindow } from './workspace-context';
import { resolveParentPath } from './parent-path';

/**
 * The router's navigator is a real history object at runtime; react-router
 * only types the portable part of it. Memory history (one per workspace
 * window, ADR-0054) and the browser history both expose a numeric `index`.
 * This interop cast is the documented exception to "no `as`" (standards §4):
 * the field is read defensively and a missing value simply disables the
 * in-window step-back branch.
 */
function readHistoryIndex(navigator: unknown): number | null {
  if (navigator === null || typeof navigator !== 'object') return null;
  const index = (navigator as { index?: unknown }).index;
  return typeof index === 'number' ? index : null;
}

export interface UseFormPageBackOptions {
  /**
   * A page-declared parent for this workflow step. Use it when the previous
   * step is not the record's list (e.g. a document form that belongs to the
   * movements screen). It is only honoured when it is a real destination.
   */
  backTo?: string | undefined;
}

/**
 * The Back action for the shared form header.
 *
 * Resolution order — every branch is a real in-app destination, and the same
 * hook serves every workspace window (no second navigation history):
 *
 *  1. The window's OWN history, when it really has a previous entry AND the
 *     window has no unsaved form. This is the exact previous step of a
 *     nested workflow (record → edit, form → its lines page) and keeps that
 *     step's state alive.
 *  2. The window this one was opened from, when it is still open — the list,
 *     with its filters, that the record was opened from (ADR-0054 reuse).
 *  3. The route-convention parent screen (`parent-path.ts`), activated as a
 *     window inside the workspace or navigated to outside it.
 *  4. Outside the workspace (unit tests, non-shell rendering): browser
 *     history if it has an in-app entry, otherwise a replace to the parent so
 *     no dead back entry is created.
 */
export function useFormPageBack({
  backTo,
}: UseFormPageBackOptions = {}): () => void {
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const runtime = useWorkspaceWindow();
  const navigation = useContext(UNSAFE_NavigationContext);
  const navigator = navigation.navigator as unknown;

  const windowIsDirty = runtime?.dirty ?? false;

  return useCallback(() => {
    // 1. A real previous entry inside this window — but never step away from
    //    an unsaved form (the dock keeps the draft window, W-05/§4.7): a dirty
    //    window only ever activates another window instead of losing input.
    const index = readHistoryIndex(navigator);
    if (!windowIsDirty && index !== null && index > 0) {
      navigate(-1);
      return;
    }

    const parentPath = resolveParentPath({
      pathname: location.pathname,
      explicitTarget: backTo,
    });

    if (workspace !== null) {
      // 2. The window this one was opened from — still open, filters intact.
      const openedFrom = runtime?.openedFrom ?? null;
      if (openedFrom !== null && openedFrom !== runtime?.basePath) {
        const origin = workspace.state.windows.find(
          (window) => window.basePath === openedFrom,
        );
        if (origin !== undefined && origin.id !== runtime?.id) {
          workspace.activate(origin.id);
          return;
        }
      }
      // 3. The route-convention parent, opened/reused as a window.
      workspace.open(parentPath);
      return;
    }

    // 4. No shell around this page: stay inside the app if there is history.
    const browserIndex = readHistoryIndex(window.history.state);
    if (browserIndex !== null && browserIndex > 0) {
      navigate(-1);
      return;
    }
    navigate(parentPath, { replace: true });
  }, [
    backTo,
    location.pathname,
    navigate,
    navigator,
    runtime?.basePath,
    runtime?.id,
    runtime?.openedFrom,
    windowIsDirty,
    workspace,
  ]);
}
