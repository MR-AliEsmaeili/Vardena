/**
 * Organization / financial-context change → `workspace.reset()` (W-06, §6.8).
 *
 * Rendered inside the provider by `AppShell` (kept out of
 * `workspace-context.tsx` so that module has zero feature imports — forms
 * and pages import the workspace hooks directly).
 *
 * The first observed scope only PRIMES the watcher (bootstrap selections
 * are not resets); a switch is recognized only between two real scopes
 * while the workspace is ready. The header switchers are separately
 * disabled while a dirty window exists, so a reset never discards unsaved
 * work silently (§4.6).
 */

import { useEffect, useRef } from 'react';
import { useOrganization } from '@/features/organization/use-organization';
import { useWorkspace } from './workspace-context';

export function WorkspaceScopeReset(): null {
  const workspace = useWorkspace();
  const { organization, financialArea, fiscalYear } = useOrganization();
  const scopeKey = [
    organization?.id ?? '',
    financialArea?.id ?? '',
    fiscalYear?.id ?? '',
  ].join('|');
  const previousRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = scopeKey;
    if (previous === null || previous === scopeKey) return;
    if (workspace === null || !workspace.ready) return;
    const [prevOrg, prevArea, prevYear] = previous.split('|');
    const [org, area, year] = scopeKey.split('|');
    const changed =
      (prevOrg !== '' && org !== '' && prevOrg !== org) ||
      (prevArea !== '' && area !== '' && prevArea !== area) ||
      (prevYear !== '' && year !== '' && prevYear !== year);
    if (changed) workspace.reset();
  }, [scopeKey, workspace]);

  return null;
}
