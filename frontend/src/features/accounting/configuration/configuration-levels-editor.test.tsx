import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import { renderWithProviders } from '@/test/test-utils';
import type { ConfigurationLevelDraft } from './configuration-levels';
import { ConfigurationLevelsEditor } from './configuration-levels-editor';

function renderEditor(
  levels: ConfigurationLevelDraft[],
  overrides: Partial<Parameters<typeof ConfigurationLevelsEditor>[0]> = {},
) {
  const handlers = {
    onAdd: vi.fn(),
    onRemoveLast: vi.fn(),
    onChange: vi.fn(),
  };
  renderWithProviders(
    <ConfigurationLevelsEditor
      levels={levels}
      rows={{}}
      continuityInvalid={false}
      totalLengthInvalid={false}
      {...handlers}
      {...overrides}
    />,
    { withProviders: false },
  );
  return handlers;
}

const twoLevels: ConfigurationLevelDraft[] = [
  {
    levelIndex: 1,
    title: 'گروه',
    digitLength: 2,
    defaultIsPostable: false,
    levelKind: 'group',
  },
  {
    levelIndex: 2,
    title: 'کل',
    digitLength: 4,
    defaultIsPostable: true,
    levelKind: '',
  },
];

describe('ConfigurationLevelsEditor', () => {
  it('renders one row per level with the server pattern rule as a preview', () => {
    renderEditor(twoLevels);
    expect(screen.getAllByTestId('configuration-level-row')).toHaveLength(2);
    expect(
      screen.getByTestId('configuration-pattern-preview'),
    ).toHaveTextContent('2 + 4');
    expect(
      screen.getAllByLabelText(t.accountingConfig.levelTitle)[0],
    ).toHaveValue('گروه');
  });

  it('emits structural changes instead of owning the level array', async () => {
    const user = userEvent.setup();
    const handlers = renderEditor(twoLevels);

    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.addLevel }),
    );
    expect(handlers.onAdd).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.removeLevel }),
    );
    expect(handlers.onRemoveLast).toHaveBeenCalledTimes(1);
  });

  it('never offers removing the only remaining level', () => {
    renderEditor([twoLevels[0]!]);
    expect(
      screen.getByRole('button', { name: t.accountingConfig.removeLevel }),
    ).toBeDisabled();
  });

  it('reports row and set-level problems', () => {
    renderEditor(twoLevels, {
      rows: { 2: { digitLength: 'digitsRange' } },
      totalLengthInvalid: true,
    });
    expect(
      screen.getByText(t.accountingConfig.digitLengthInvalid),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t.accountingConfig.totalLengthInvalid),
    ).toBeInTheDocument();
  });

  it('patches one row without touching the others', async () => {
    const user = userEvent.setup();
    const handlers = renderEditor(twoLevels);
    const digits = screen.getAllByLabelText(t.accountingConfig.digitLength)[1]!;
    // The component is controlled by its owner, so the harness never lets the
    // DOM value drift: the emitted patch is what matters here.
    await user.clear(digits);
    expect(handlers.onChange).toHaveBeenLastCalledWith(1, { digitLength: 0 });
  });
});
