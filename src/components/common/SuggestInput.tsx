import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { filterSuggestions, type Suggestion } from '@/utils/playerNames';
import '@/styles/suggest-input.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (text: string) => void;
  /** Every candidate; the list shows the ones matching what is being typed. */
  suggestions: readonly Suggestion[];
  /** Class of the wrapper (it positions the list under the input). */
  wrapClassName?: string;
}

/** The text after the last comma: a comma list suggests for the name being typed. */
export function currentSegment(text: string): string {
  return text.slice(text.lastIndexOf(',') + 1);
}

/** Everything before the name being typed ("Anna, Be" → "Anna"). */
export function earlierSegments(text: string): string {
  const comma = text.lastIndexOf(',');
  return comma < 0 ? '' : text.slice(0, comma);
}

/**
 * A text input with an autocomplete list under it — the player add fields of
 * the show and the gamemaster. The list opens while typing; arrow keys move,
 * Escape closes it. Enter on the highlighted entry, or a tap, only FILLS IN
 * that entry's label (in place of the name being typed, after any earlier
 * comma-separated names) and closes the list, keeping the focus; the next
 * Enter does what Enter always does there — submit or commit the text.
 * ArrowDown while no list is showing — or a click/tap into the field while it
 * already has the focus — opens the WHOLE list (every candidate except the
 * full-name-only ones), first entry highlighted; typing goes back to
 * filtering. See specs/players.md ("Autocomplete").
 */
export default function SuggestInput({
  value,
  onValueChange,
  suggestions,
  wrapClassName,
  onKeyDown,
  onFocus,
  onBlur,
  onMouseDown,
  onClick,
  ...inputProps
}: Props) {
  const [open, setOpen] = useState(false);
  // ArrowDown on a field without a list: show every candidate, not the matches.
  const [browse, setBrowse] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();
  const listRef = useRef<HTMLSpanElement>(null);
  // Whether the field already had the focus when this click started.
  const focusedAtDownRef = useRef(false);
  const items = !open
    ? []
    : browse
      ? suggestions.filter(s => !s.fullMatch)
      : filterSuggestions(suggestions, currentSegment(value));
  const shown = items.length > 0;
  const active = highlight >= 0 && highlight < items.length ? highlight : -1;

  // Keep the highlighted entry in view while arrowing through a long list.
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const close = () => {
    setOpen(false);
    setBrowse(false);
    setHighlight(-1);
  };

  const pick = (item: Suggestion) => {
    close();
    const before = earlierSegments(value).trim();
    onValueChange(before ? `${before}, ${item.label}` : item.label);
  };

  const hasBrowsable = suggestions.some(s => !s.fullMatch);
  const openWholeList = () => {
    setOpen(true);
    setBrowse(true);
    setHighlight(0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shown && e.key === 'ArrowDown' && hasBrowsable) {
      e.preventDefault();
      e.stopPropagation();
      openWholeList();
      return;
    }
    if (shown) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight(Math.max(-1, Math.min(items.length - 1, active + step)));
        return;
      }
      if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pick(items[active]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <span className={`suggest-wrap${wrapClassName ? ` ${wrapClassName}` : ''}`}>
      <input
        {...inputProps}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={e => { onValueChange(e.target.value); setOpen(true); setBrowse(false); setHighlight(-1); }}
        onFocus={e => { setOpen(true); onFocus?.(e); }}
        onBlur={e => { close(); onBlur?.(e); }}
        onMouseDown={e => {
          focusedAtDownRef.current = document.activeElement === e.currentTarget;
          onMouseDown?.(e);
        }}
        onClick={e => {
          // A click into the field that is already focused: like ArrowDown.
          // The click that focuses it only places the caret.
          if (focusedAtDownRef.current && !shown && hasBrowsable) openWholeList();
          onClick?.(e);
        }}
        onKeyDown={handleKeyDown}
      />
      {shown && (
        <span className="suggest-list" id={listId} role="listbox" data-gm-no-nav="" ref={listRef}>
          {items.map((item, i) => (
            <button
              key={item.id}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              className={`suggest-item${i === active ? ' is-active' : ''}`}
              // mousedown, not click: picking must not blur the input first.
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); pick(item); }}
              onClick={e => e.stopPropagation()}
              onMouseEnter={() => setHighlight(i)}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
