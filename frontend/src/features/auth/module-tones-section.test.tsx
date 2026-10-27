/**
 * ModuleTonesSection — the profile colour-module UI (D-3, §4.3, §6.10·ب).
 * Re-assignment only (never raw colours), swap preserves the bijection,
 * commits persist to localStorage AND apply to <html> instantly, and the
 * dual-theme preview reads the SOURCE tiles.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import {
  DEFAULT_MODULE_TONES as REAL_DEFAULTS,
  MODULE_IDS as REAL_MODULE_IDS,
} from '@/lib/module-tones';
import {
  MODULE_TONES_STORAGE_KEY,
  readModuleTones,
} from '@/lib/module-tones-storage';
import { ModuleTonesSection } from './module-tones-section';

function selectOf(moduleId: string) {
  return screen.getByTestId(`module-tone-select-${moduleId}`);
}

describe('ModuleTonesSection', () => {
  it('renders one selector per module with the shipped identity mapping', () => {
    render(<ModuleTonesSection />);
    expect(screen.getByTestId('module-tones-section')).toBeInTheDocument();
    expect(screen.getByText(t.workspace.tonesSectionTitle)).toBeInTheDocument();
    for (const moduleId of REAL_MODULE_IDS) {
      const select = selectOf(moduleId);
      expect(select).toHaveValue(REAL_DEFAULTS[moduleId]);
      // The options are exactly the six tone names — no free-form colour.
      expect(select.querySelectorAll('option')).toHaveLength(
        REAL_MODULE_IDS.length,
      );
    }
    // Dual-theme preview containers (§4.3).
    expect(screen.getByTestId('module-tones-preview-light')).toHaveAttribute(
      'data-theme',
      'light',
    );
    expect(screen.getByTestId('module-tones-preview-dark')).toHaveAttribute(
      'data-theme',
      'dark',
    );
  });

  it('re-assigning swaps with the current owner and commits everywhere', () => {
    render(<ModuleTonesSection />);
    fireEvent.change(selectOf('accounting'), {
      target: { value: 'inventory' },
    });

    // The bijection: inventory now wears accounting's old tone.
    expect(selectOf('accounting')).toHaveValue('inventory');
    expect(selectOf('inventory')).toHaveValue('accounting');

    // Persisted…
    expect(readModuleTones(localStorage)).toEqual({
      ...REAL_DEFAULTS,
      accounting: 'inventory',
      inventory: 'accounting',
    });

    // …and applied to <html> through the src indirection (no raw colours).
    const applied = document.documentElement.style.getPropertyValue(
      '--color-tone-accounting-soft',
    );
    expect(applied).toBe('var(--color-tone-src-inventory-soft)');
  });

  it('choosing the tone a module already has is a no-op', () => {
    render(<ModuleTonesSection />);
    fireEvent.change(selectOf('admin'), { target: { value: 'admin' } });
    expect(selectOf('admin')).toHaveValue('admin');
    expect(localStorage.getItem(MODULE_TONES_STORAGE_KEY)).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-tone-admin-soft',
      ),
    ).toBe('');
  });

  it('reset restores the shipped mapping and clears the inline overrides', () => {
    localStorage.setItem(
      MODULE_TONES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tones: {
          ...REAL_DEFAULTS,
          workspace: 'admin',
          admin: 'workspace',
        },
      }),
    );
    render(<ModuleTonesSection />);
    // The stored swap is what the grid shows on a fresh mount.
    expect(selectOf('workspace')).toHaveValue('admin');
    expect(selectOf('admin')).toHaveValue('workspace');

    fireEvent.click(screen.getByTestId('module-tones-reset'));
    for (const moduleId of REAL_MODULE_IDS) {
      expect(selectOf(moduleId)).toHaveValue(REAL_DEFAULTS[moduleId]);
    }
    // Identity mapping = no inline custom properties at all.
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-tone-workspace-soft',
      ),
    ).toBe('');
    expect(readModuleTones(localStorage)).toEqual(REAL_DEFAULTS);
  });
});
