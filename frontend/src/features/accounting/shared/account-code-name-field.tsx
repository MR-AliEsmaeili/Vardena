/*
 * ARIA combobox note: a native <select>/<datalist> cannot express this control
 * (code + title suggestions, one non-selectable "aggregate" option, a popup
 * that must escape the grid's scroll container). The listbox/option roles are
 * therefore required by the ARIA combobox pattern, and keyboard focus stays in
 * the input, so the two a11y lint rules below do not apply to this file.
 */
/* oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { Account } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { normalizeSearchText } from '@/lib/text-normalize';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { Input } from '@/ui/input';
import { useAccountById, useActiveAccounts } from './use-accounting-references';

export interface AccountCodeNameFieldProps {
  /** id prefix; the two inputs become `${id}-code` and `${id}-title`. */
  id: string;
  organizationId: string | null;
  /** Selected account id (`''` = no account). */
  value: string;
  onChange: (accountId: string) => void;
  error?: string | undefined;
  disabled?: boolean;
}

interface SuggestionPosition {
  top: number;
  left: number;
  width: number;
  /** Open upwards when there is no room below the cell. */
  flip: boolean;
}

const LIST_MAX_HEIGHT = 224;

/** Stable empty list: a fresh array would re-run the linking effect. */
const EMPTY_ACCOUNTS: readonly Account[] = [];

/**
 * Linked «کد حساب / نام حساب» field for a document line (FE-UX-08 §8.4).
 *
 * The previous control stacked a native select AND a separate search box in
 * one cell — two lines of controls in a 29px row, which breaks the grid's
 * density standard and still could not answer "which code is this title?".
 *
 * This is ONE single-line compound control:
 * - both inputs search the same server-side list (`code` OR `title`), so the
 *   operator can type either the code or the name;
 * - the two fields are LINKED: an exact code fills the real title and an exact
 *   title fills the real code, and a partial edit that no longer resolves to
 *   the selected account clears the selection instead of leaving a
 *   mismatched pair behind;
 * - the suggestion list is portalled and positioned from the cell's rect, so
 *   the grid's scroll container never clips it.
 *
 * The backend remains the authority on postability: an aggregate (non-postable)
 * account is shown in the list — an operator must be able to find the account
 * they created — but it is marked and cannot be selected for a posting line.
 */
export function AccountCodeNameField({
  id,
  organizationId,
  value,
  onChange,
  error,
  disabled = false,
}: AccountCodeNameFieldProps): ReactElement {
  const codeId = `${id}-code`;
  const titleId = `${id}-title`;
  const listId = useId();

  const [search, setSearch] = useState('');
  const [codeDraft, setCodeDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<SuggestionPosition | null>(null);
  const wrapperRef = useRef<HTMLFieldSetElement>(null);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const optionsQuery = useActiveAccounts(organizationId, debouncedSearch);
  const selectedQuery = useAccountById(
    organizationId,
    value === '' ? undefined : value,
  );

  const options = optionsQuery.data?.items ?? EMPTY_ACCOUNTS;
  const selected = value === '' ? undefined : selectedQuery.data;
  const selectedIsPostable = selected?.isPostable ?? true;
  const errorId = `${id}-error`;

  // The resolved account is the source of truth for both halves of the field:
  // an edit-mode prefill (or a parent reset) must be reflected in both inputs.
  useEffect(() => {
    if (selected === undefined) return;
    // oxlint-disable-next-line react/set-state-in-effect -- the drafts mirror the account resolved by the SERVER, an external source of truth.
    setCodeDraft(selected.code);
    // oxlint-disable-next-line react/set-state-in-effect -- same server-resolved account, second half of the linked pair.
    setTitleDraft(selected.title);
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const measure = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
      flip: rect.bottom + LIST_MAX_HEIGHT > window.innerHeight,
    });
  };

  const openList = (term: string) => {
    // Re-focusing the same term (a blur that the browser restores, a click
    // back into the cell) must not throw away the highlighted suggestion.
    if (term !== search) setActiveIndex(-1);
    setSearch(term);
    measure();
    setOpen(true);
  };

  const selectAccount = (account: Account) => {
    if (!account.isPostable) return;
    setCodeDraft(account.code);
    setTitleDraft(account.title);
    setSearch('');
    setOpen(false);
    setActiveIndex(-1);
    onChange(account.id);
  };

  const clearSelection = () => {
    setCodeDraft('');
    setTitleDraft('');
    setSearch('');
    onChange('');
  };

  const handleCodeChange = (next: string) => {
    setCodeDraft(next);
    openList(next);
    const normalized = normalizeSearchText(next);
    if (normalized === '') {
      clearSelection();
      return;
    }
    const exact = options.find(
      (account) => normalizeSearchText(account.code) === normalized,
    );
    if (exact !== undefined && exact.isPostable) {
      setCodeDraft(exact.code);
      setTitleDraft(exact.title);
      onChange(exact.id);
      return;
    }
    setTitleDraft('');
    if (value !== '') onChange('');
  };

  const handleTitleChange = (next: string) => {
    setTitleDraft(next);
    openList(next);
    const normalized = normalizeSearchText(next);
    if (normalized === '') {
      clearSelection();
      return;
    }
    const exact = options.find(
      (account) => normalizeSearchText(account.title) === normalized,
    );
    if (exact !== undefined && exact.isPostable) {
      setCodeDraft(exact.code);
      setTitleDraft(exact.title);
      onChange(exact.id);
      return;
    }
    setCodeDraft('');
    if (value !== '') onChange('');
  };

  // A fast typist can finish a code before the server answers that term: link
  // the pair as soon as the resolved options arrive, not only on key-down.
  // (Only `onChange` is called here; the drafts already hold the typed text.)
  useEffect(() => {
    if (value !== '') return;
    const codeTerm = normalizeSearchText(codeDraft);
    const titleTerm = normalizeSearchText(titleDraft);
    if (codeTerm === '' && titleTerm === '') return;
    const match =
      codeTerm !== ''
        ? options.find(
            (account) => normalizeSearchText(account.code) === codeTerm,
          )
        : options.find(
            (account) => normalizeSearchText(account.title) === titleTerm,
          );
    if (match === undefined || !match.isPostable) return;
    onChange(match.id);
  }, [codeDraft, onChange, options, titleDraft, value]);

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (wrapperRef.current?.contains(event.relatedTarget)) return;
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        setOpen(false);
        event.stopPropagation();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // The parent DetailGrid moves vertically between rows on Arrow keys;
      // while the suggestion list is open the arrows belong to the list.
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        if (options.length === 0) return -1;
        return (current + delta + options.length) % options.length;
      });
      return;
    }
    if (event.key === 'Enter' && open) {
      // Enter commits the highlighted suggestion, or the first selectable one
      // when nothing is highlighted yet — an open list must never swallow
      // Enter silently while the operator is looking at a match.
      const highlighted = activeIndex >= 0 ? options[activeIndex] : undefined;
      const option =
        highlighted ?? options.find((account) => account.isPostable);
      if (option !== undefined && option.isPostable) {
        event.preventDefault();
        event.stopPropagation();
        selectAccount(option);
      }
    }
  };

  const isLoading = optionsQuery.isFetching || selectedQuery.isFetching;
  const hasSelectionMismatch =
    value === '' && (codeDraft !== '' || titleDraft !== '');

  return (
    <div className="relative min-w-56">
      <fieldset
        ref={wrapperRef}
        className="m-0 grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] items-start gap-1 border-0 p-0"
      >
        <legend className="sr-only">
          {`${t.documents.accountCode} / ${t.documents.accountName}`}
        </legend>
        <Input
          id={codeId}
          dir="ltr"
          className="code h-8 text-xs"
          placeholder={t.documents.accountCode}
          aria-label={t.documents.accountCode}
          aria-invalid={error !== undefined}
          aria-describedby={error !== undefined ? errorId : undefined}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          autoComplete="off"
          value={codeDraft}
          disabled={disabled}
          onChange={(event) => handleCodeChange(event.target.value)}
          onFocus={() => openList(search)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        <Input
          id={titleId}
          className="h-8 text-xs"
          placeholder={t.documents.accountName}
          aria-label={t.documents.accountName}
          aria-invalid={error !== undefined || hasSelectionMismatch}
          aria-describedby={error !== undefined ? errorId : undefined}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          autoComplete="off"
          value={titleDraft}
          disabled={disabled}
          onChange={(event) => handleTitleChange(event.target.value)}
          onFocus={() => openList(search)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </fieldset>

      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-ink">
          {error}
        </p>
      )}

      {value !== '' && selected !== undefined && !selectedIsPostable && (
        <p className="mt-1 text-[0.6875rem] text-warn-ink">
          {t.documents.accountAggregateOption}
        </p>
      )}

      {open &&
        position !== null &&
        createPortal(
          <div
            className="fixed z-[70] overflow-hidden rounded-card border border-line bg-surface shadow-raised"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: LIST_MAX_HEIGHT,
              transform: position.flip
                ? `translateY(-${LIST_MAX_HEIGHT + 8}px)`
                : undefined,
            }}
            data-testid="account-suggestions"
          >
            <ul
              id={listId}
              role="listbox"
              aria-label={t.documents.accountSuggestions}
              className="max-h-56 overflow-y-auto p-1"
            >
              {isLoading && options.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-ink-subtle">
                  {t.documents.accountPickerLoading}
                </li>
              )}
              {!isLoading && options.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-ink-subtle">
                  {t.documents.accountNotFound}
                </li>
              )}
              {options.map((account, index) => (
                // ARIA option rows are not focusable by design: keyboard
                // interaction is owned by the combobox input (arrows/Enter).
                <li
                  key={account.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-disabled={!account.isPostable}
                  data-postable={account.isPostable ? 'true' : 'false'}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs',
                    index === activeIndex && 'bg-sunken',
                    account.isPostable
                      ? 'text-ink'
                      : 'cursor-not-allowed text-ink-subtle',
                  )}
                  // Keep the focus in the input (the list is portalled), and
                  // never let an aggregate account be chosen for a line.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectAccount(account)}
                >
                  <span className="code w-16 shrink-0 font-medium">
                    {account.code}
                  </span>
                  <span className="truncate">{account.title}</span>
                  {!account.isPostable && (
                    <span className="ms-auto shrink-0 text-[0.625rem] text-warn-ink">
                      {t.documents.accountAggregateOption}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
