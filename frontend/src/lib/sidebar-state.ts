/**
 * Sidebar persistence — collapsed state and expanded section groups.
 *
 * Collapsed state is device-local (localStorage). Expanded groups default to
 * all-open; only explicitly collapsed groups are stored.
 */

export const SIDEBAR_STORAGE_KEY = 'vardena:sidebar:v1';

export interface SidebarPersistedState {
  collapsed: boolean;
  collapsedGroups: string[];
}

export const DEFAULT_SIDEBAR_STATE: SidebarPersistedState = {
  collapsed: false,
  collapsedGroups: [],
};

export function parseSidebarState(raw: string | null): SidebarPersistedState {
  if (raw === null) return { ...DEFAULT_SIDEBAR_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<SidebarPersistedState>;
    return {
      collapsed:
        typeof parsed.collapsed === 'boolean' ? parsed.collapsed : false,
      collapsedGroups: Array.isArray(parsed.collapsedGroups)
        ? parsed.collapsedGroups.filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
    };
  } catch {
    return { ...DEFAULT_SIDEBAR_STATE };
  }
}

export function readSidebarState(): SidebarPersistedState {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SIDEBAR_STATE };
  try {
    return parseSidebarState(localStorage.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SIDEBAR_STATE };
  }
}

export function persistSidebarState(state: SidebarPersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort
  }
}
