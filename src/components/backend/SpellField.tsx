/**
 * SpellField — drop-in replacement for a prose `<input className="be-input">` /
 * `<textarea>` that draws inline wavy underlines under flagged words and opens a
 * fix popover on click. See specs/spellcheck.md.
 *
 * MIGRATION SAFETY: when spellcheck is disabled or the field has no matches, this
 * renders the bare input/textarea with identical props — same DOM, same behavior as
 * before. The overlay only mounts when there are matches to show.
 *
 * Technique: a mirror overlay is layered ON TOP of the input (pointer-events: none)
 * with transparent text; only the wavy underline decoration on matched spans is
 * visible, so squiggles appear under the real text. Scroll is synced so they track.
 */

import { useRef, useState, useLayoutEffect, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { SpellMatch } from '@/services/backendApi';
import { useSpellField } from './SpellCheckContext';

// Props mirror a plain `<input className="be-input">`. The `as='textarea'` branch exists
// for completeness but isn't used by current prose fields (the one textarea — answerList —
// stays a plain input because it edits a joined list, not a single segment).
type SpellFieldProps = {
  segKey: string;
  as?: 'input' | 'textarea';
  value: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value'>;

function isSpelling(m: SpellMatch): boolean {
  return m.issueType === 'misspelling' || m.categoryId.toUpperCase() === 'TYPOS';
}

/** Non-overlapping matches sorted by offset (drop later matches that overlap an earlier one). */
function sortedNonOverlapping(matches: SpellMatch[]): SpellMatch[] {
  const sorted = [...matches].sort((a, b) => a.offset - b.offset);
  const out: SpellMatch[] = [];
  let cursor = -1;
  for (const m of sorted) {
    if (m.offset >= cursor) {
      out.push(m);
      cursor = m.offset + m.length;
    }
  }
  return out;
}

export default function SpellField({ segKey, as = 'input', value, ...rest }: SpellFieldProps) {
  const spell = useSpellField(segKey);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<SpellMatch | null>(null);

  const matches = spell.enabled ? sortedNonOverlapping(spell.matches) : [];
  const active = spell.enabled && matches.length > 0;

  // Keep the overlay scroll in sync with the input.
  useLayoutEffect(() => {
    if (!active) return;
    const el = inputRef.current;
    const ov = overlayRef.current;
    if (!el || !ov) return;
    const sync = () => { ov.scrollLeft = el.scrollLeft; ov.scrollTop = el.scrollTop; };
    sync();
    el.addEventListener('scroll', sync);
    return () => el.removeEventListener('scroll', sync);
  }, [active, value]);

  // Plain passthrough when there's nothing to show — identical to the old input.
  if (!active) {
    if (as === 'textarea') {
      return <textarea value={value} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />;
    }
    return <input value={value} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />;
  }

  // Build the mirrored text with underline spans for matched ranges.
  const segments: { text: string; match?: SpellMatch }[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.offset > pos) segments.push({ text: value.slice(pos, m.offset) });
    segments.push({ text: value.slice(m.offset, m.offset + m.length), match: m });
    pos = m.offset + m.length;
  }
  if (pos < value.length) segments.push({ text: value.slice(pos) });

  const findMatchAtCaret = () => {
    const el = inputRef.current;
    if (!el) return null;
    const caret = el.selectionStart ?? 0;
    return matches.find(m => caret >= m.offset && caret <= m.offset + m.length) ?? null;
  };

  // The overlay must NOT inherit the input's `.be-input` class (it would draw a second
  // background/border). It replicates only the box metrics via `.spellfield-overlay`.
  const overlayClass = `spellfield-overlay ${as === 'textarea' ? 'spellfield-overlay--textarea' : ''}`;

  const closePopover = () => setPopover(null);

  const sharedHandlers = {
    onClick: () => setPopover(findMatchAtCaret()),
    onKeyUp: () => { if (popover) setPopover(findMatchAtCaret()); },
    onBlur: () => { /* keep popover; closed via its buttons or re-click */ },
  };

  return (
    <span className={`spellfield-wrap ${as === 'textarea' ? 'spellfield-wrap--textarea' : ''}`}>
      <div ref={overlayRef} className={overlayClass} aria-hidden="true">
        {segments.map((s, i) =>
          s.match ? (
            <span key={i} className={`spell-underline ${isSpelling(s.match) ? 'spell-underline--spelling' : 'spell-underline--grammar'}`}>
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          )
        )}
        {/* trailing newline keeps textarea mirror height in sync with a trailing blank line */}
        {as === 'textarea' && value.endsWith('\n') ? '​' : ''}
      </div>
      {as === 'textarea' ? (
        <textarea ref={inputRef} value={value} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} {...sharedHandlers} />
      ) : (
        <input ref={inputRef} value={value} {...(rest as InputHTMLAttributes<HTMLInputElement>)} {...sharedHandlers} />
      )}

      {popover && (
        <div className="spell-popover" role="dialog">
          <div className="spell-popover-msg">{popover.message || popover.shortMessage}</div>
          <div className="spell-popover-actions">
            {popover.replacements.slice(0, 4).map((r, i) => (
              <button
                key={i}
                type="button"
                className="be-btn-primary spell-popover-fix"
                onClick={() => { spell.apply(popover, r); closePopover(); }}
              >
                {`„${r}“`}
              </button>
            ))}
            {isSpelling(popover) && (
              <button
                type="button"
                className="be-icon-btn"
                onClick={() => { spell.allowWord(value.slice(popover.offset, popover.offset + popover.length)); closePopover(); }}
              >
                Erlauben
              </button>
            )}
            <button type="button" className="be-icon-btn" onClick={() => { spell.ignore(popover.fingerprint); closePopover(); }}>
              Ignorieren
            </button>
            <button type="button" className="be-icon-btn" onClick={closePopover}>Schließen</button>
          </div>
        </div>
      )}
    </span>
  );
}
