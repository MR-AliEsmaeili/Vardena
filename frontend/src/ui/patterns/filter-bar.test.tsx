import type { FormEvent } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import { FilterBar, FilterField } from './filter-bar';

/**
 * One toolbar for every list surface (standards.md §2/§8). What is pinned
 * here is the contract the callers rely on: whether a bar submits or applies
 * instantly, that apply/reset share one action row, and that a blocked or
 * in-flight state disables the submit instead of silently dropping the click.
 */
describe('FilterBar', () => {
  it('renders a labelled form and submits the applied values', async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    const user = userEvent.setup();
    render(
      <FilterBar onSubmit={onSubmit} aria-label="فیلتر اسناد">
        <FilterField label="وضعیت">
          <input defaultValue="" />
        </FilterField>
      </FilterBar>,
    );

    await user.click(screen.getByRole('button', { name: t.app.apply }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('form', { name: 'فیلتر اسناد' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('وضعیت')).toBeInTheDocument();
  });

  it('applies instantly without an apply button when no submit is given', () => {
    render(
      <FilterBar aria-label="فیلتر وضعیت ارزشیابی" columns={2}>
        <FilterField label="وضعیت">
          <input />
        </FilterField>
      </FilterBar>,
    );

    expect(
      screen.queryByRole('button', { name: t.app.apply }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'فیلتر وضعیت ارزشیابی' }),
    ).toBeInTheDocument();
  });

  it('puts reset beside apply and disables both while fetching', async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    const onClear = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBar onSubmit={onSubmit} onClear={onClear}>
        <FilterField label="وضعیت">
          <input />
        </FilterField>
      </FilterBar>,
    );

    await user.click(screen.getByRole('button', { name: t.filters.reset }));
    expect(onClear).toHaveBeenCalledTimes(1);

    rerender(
      <FilterBar onSubmit={onSubmit} onClear={onClear} isFetching>
        <FilterField label="وضعیت">
          <input />
        </FilterField>
      </FilterBar>,
    );

    expect(screen.getByRole('button', { name: t.app.apply })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: t.filters.reset }),
    ).toBeDisabled();
  });

  it('blocks only apply while the scope is not ready', () => {
    render(
      <FilterBar
        onSubmit={(event) => event.preventDefault()}
        onClear={vi.fn()}
        applyDisabled
      >
        <FilterField label="کالا">
          <input />
        </FilterField>
      </FilterBar>,
    );

    expect(screen.getByRole('button', { name: t.app.apply })).toBeDisabled();
    expect(screen.getByRole('button', { name: t.filters.reset })).toBeEnabled();
  });

  it('renders caller actions and the requested field columns', () => {
    const { container } = render(
      <FilterBar onSubmit={(event) => event.preventDefault()} columns={3}>
        <FilterField label="کالا">
          <input />
        </FilterField>
        <span>عملیات اضافه</span>
      </FilterBar>,
    );

    expect(screen.getByText('عملیات اضافه')).toBeInTheDocument();
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('lg:grid-cols-3');
    expect(grid).toHaveClass('sm:grid-cols-2');
  });
});
