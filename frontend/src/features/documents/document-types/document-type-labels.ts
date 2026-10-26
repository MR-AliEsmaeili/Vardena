import { t } from '@/lib/i18n';

/**
 * Display labels for the registry's enum-like metadata (DOC-01).
 *
 * `entryStates` (`temporary`/`final`) and `deletablePhases`
 * (`draft`/`temporary`/`final`) arrive from the backend registry; the UI
 * never invents a member. Known values get dictionary copy; an unforeseen
 * server value stays visible verbatim (in its own LTR span at the call site)
 * instead of being silently dropped or translated into a wrong label.
 */

function join(values: readonly string[]): string {
  return values.join(t.documentTypes.listSeparator);
}

export function documentTypeStateLabel(state: string): string {
  if (state === 'temporary' || state === 'final') {
    return t.documentTypes.stateNames[state];
  }
  return state;
}

export function documentTypePhaseLabel(phase: string): string {
  if (phase === 'draft' || phase === 'temporary' || phase === 'final') {
    return t.documentTypes.phaseNames[phase];
  }
  return phase;
}

export function documentTypeStatesLabel(states: readonly string[]): string {
  if (states.length === 0) return t.app.none;
  return join(states.map(documentTypeStateLabel));
}

export function documentTypePhasesLabel(phases: readonly string[]): string {
  if (phases.length === 0) return t.app.none;
  return join(phases.map(documentTypePhaseLabel));
}
