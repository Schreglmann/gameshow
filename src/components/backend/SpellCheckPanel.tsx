/**
 * Presentational report panel for spellcheck results. Reused by the per-game check
 * (GameEditor) and the whole-show scan (LektoratTab). The host supplies grouped
 * issues + action callbacks; this component renders cards and wires the buttons.
 * See specs/spellcheck.md.
 */

import { useState } from 'react';
import type { SpellMatch } from '@/services/backendApi';
import { issueExplanationDe, ruleExplanationDe } from '@/utils/spellcheckExplain';

export interface SpellIssue {
  /** Unique id within the panel (segment key, possibly instance-qualified). */
  id: string;
  /** German label, e.g. "Frage 4 · Antwort". */
  label: string;
  /** Full segment text, for context display. */
  text: string;
  match: SpellMatch;
}

export interface SpellGroup {
  /** Stable identity for collapse state — survives re-renders + fixes. Falls back to `groupLabel`. */
  key?: string;
  groupLabel?: string;
  deepLink?: () => void;
  issues: SpellIssue[];
}

interface Props {
  groups: SpellGroup[];
  loading?: boolean;
  /** Two-phase scan progress: `load` counts games fetched, `check` counts text fields checked.
   *  The unit differs per phase so the displayed state matches what is actually happening. */
  progress?: { phase: 'load' | 'check'; done: number; total: number } | null;
  error?: string | null;
  emptyText?: string;
  onApply: (issue: SpellIssue, replacement: string) => void;
  onAllowWord: (issue: SpellIssue) => void;
  onIgnore: (issue: SpellIssue) => void;
}

function isSpelling(m: SpellMatch): boolean {
  return m.issueType === 'misspelling' || m.categoryId.toUpperCase() === 'TYPOS';
}

function contextSlices(text: string, offset: number, length: number, window = 48) {
  const matched = text.slice(offset, offset + length);
  const beforeFull = text.slice(0, offset);
  const afterFull = text.slice(offset + length);
  const before = beforeFull.length > window ? '…' + beforeFull.slice(-window) : beforeFull;
  const after = afterFull.length > window ? afterFull.slice(0, window) + '…' : afterFull;
  return { before, matched, after };
}

export function SpellIssueCard({
  issue,
  onApply,
  onAllowWord,
  onIgnore,
}: {
  issue: SpellIssue;
  onApply: Props['onApply'];
  onAllowWord: Props['onAllowWord'];
  onIgnore: Props['onIgnore'];
}) {
  const { match } = issue;
  const spelling = isSpelling(match);
  const { before, matched, after } = contextSlices(issue.text, match.offset, match.length);
  // Free-text correction — used when none of LanguageTool's suggestions fit. Pre-filled with the
  // flagged word so the user just edits it.
  const [custom, setCustom] = useState(matched);
  const applyCustom = () => {
    const value = custom;
    if (value.length === 0 || value === matched) return;
    onApply(issue, value);
  };
  return (
    <div className="spell-issue">
      <div className="spell-issue-head">
        <span className="spell-issue-label">{issue.label}</span>
        <span className={`spell-issue-tag ${spelling ? 'spell-issue-tag--spelling' : 'spell-issue-tag--grammar'}`}>
          {spelling ? 'Rechtschreibung' : 'Grammatik'}
        </span>
      </div>
      <div className="spell-issue-context">
        {before}
        <mark className={`spell-hl ${spelling ? 'spell-hl--spelling' : 'spell-hl--grammar'}`}>{matched}</mark>
        {after}
      </div>
      {/* Always German (LanguageTool's own message follows the detected language). Hover shows
          a German explanation of the underlying rule. */}
      <div className="spell-issue-msg" title={ruleExplanationDe(match.ruleId)}>{issueExplanationDe(match)}</div>
      <div className="spell-issue-actions">
        {match.replacements.slice(0, 3).map((r, i) => (
          <button key={i} type="button" className="be-btn-primary spell-issue-fix" title="Übernehmen" onClick={() => onApply(issue, r)}>
            {`„${r}“`}
          </button>
        ))}
        {spelling && (
          <button type="button" className="be-icon-btn" onClick={() => onAllowWord(issue)}>
            Wort erlauben
          </button>
        )}
        <button type="button" className="be-icon-btn" onClick={() => onIgnore(issue)}>
          Ignorieren
        </button>
      </div>
      <div className="spell-issue-custom">
        <input
          className="be-input spell-issue-custom-input"
          value={custom}
          aria-label="Eigene Korrektur"
          placeholder="Eigene Korrektur…"
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCustom(); } }}
        />
        <button type="button" className="be-icon-btn" disabled={custom.length === 0 || custom === matched} onClick={applyCustom}>
          Übernehmen
        </button>
      </div>
    </div>
  );
}

export default function SpellCheckPanel({
  groups,
  loading = false,
  progress = null,
  error = null,
  emptyText = 'Keine Auffälligkeiten gefunden.',
  onApply,
  onAllowWord,
  onIgnore,
}: Props) {
  const totalIssues = groups.reduce((n, g) => n + g.issues.length, 0);
  const spellingCount = groups.reduce((n, g) => n + g.issues.filter(i => isSpelling(i.match)).length, 0);
  const grammarCount = totalIssues - spellingCount;

  // Display filter driven by the summary pills. Counts above always reflect the FULL set; this only
  // narrows what is rendered. Auto-falls back to 'all' if the active type's count hits 0 (e.g. after
  // the last spelling issue is fixed) so the report never shows an empty filtered view.
  const [filter, setFilter] = useState<'all' | 'spelling' | 'grammar'>('all');
  const effFilter =
    (filter === 'spelling' && spellingCount === 0) || (filter === 'grammar' && grammarCount === 0) ? 'all' : filter;
  const toggleFilter = (f: 'spelling' | 'grammar') => setFilter(prev => (prev === f ? 'all' : f));
  const visibleGroups =
    effFilter === 'all'
      ? groups
      : groups
          .map(g => ({ ...g, issues: g.issues.filter(i => isSpelling(i.match) === (effFilter === 'spelling')) }))
          .filter(g => g.issues.length > 0);

  // Per-game collapse. Only labeled groups (the whole-show scan) are collapsible; the single
  // label-less group used by the per-game editor is always shown. Keyed by stable group key so the
  // collapsed state survives re-renders and fixes; a group not in the set is expanded.
  const keyOf = (g: SpellGroup) => g.key ?? g.groupLabel ?? '';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const collapsibleKeys = visibleGroups.filter(g => g.groupLabel && g.issues.length > 0).map(keyOf);
  const allCollapsed = collapsibleKeys.length > 0 && collapsibleKeys.every(k => collapsed.has(k));
  const toggleAll = () =>
    setCollapsed(prev => {
      if (allCollapsed) {
        const next = new Set(prev);
        for (const k of collapsibleKeys) next.delete(k);
        return next;
      }
      return new Set([...prev, ...collapsibleKeys]);
    });

  return (
    <div className="spell-panel">
      {error && <div className="spell-panel-error">{error}</div>}
      {!loading && !error && totalIssues > 0 && (
        <div className="spell-panel-summary" role="group" aria-label="Nach Fehlertyp filtern">
          <button
            type="button"
            className={`spell-panel-summary-pill spell-panel-summary-pill--spelling${effFilter === 'spelling' ? ' is-active' : ''}`}
            aria-pressed={effFilter === 'spelling'}
            disabled={spellingCount === 0}
            title={effFilter === 'spelling' ? 'Wieder alle Fehler anzeigen' : 'Nur Rechtschreibfehler anzeigen'}
            onClick={() => toggleFilter('spelling')}
          >
            {spellingCount} Rechtschreibung
          </button>
          <button
            type="button"
            className={`spell-panel-summary-pill spell-panel-summary-pill--grammar${effFilter === 'grammar' ? ' is-active' : ''}`}
            aria-pressed={effFilter === 'grammar'}
            disabled={grammarCount === 0}
            title={effFilter === 'grammar' ? 'Wieder alle Fehler anzeigen' : 'Nur Grammatikfehler anzeigen'}
            onClick={() => toggleFilter('grammar')}
          >
            {grammarCount} Grammatik
          </button>
        </div>
      )}
      {!loading && !error && collapsibleKeys.length > 1 && (
        <div className="spell-panel-collapse-all">
          <button type="button" className="be-icon-btn spell-collapse-all-btn" onClick={toggleAll}>
            {allCollapsed ? 'Alle ausklappen' : 'Alle einklappen'}
          </button>
        </div>
      )}
      {loading && (
        <div className="spell-panel-status">
          {progress?.phase === 'check' ? (
            // The whole show is checked in ~1 batched request, so there is no honest per-field
            // sub-progress to count up — show the scope + an indeterminate bar (never looks frozen).
            <>
              <div>Prüfe Rechtschreibung{progress.total > 0 ? ` · ${progress.total} Textfelder` : '…'}</div>
              <div className="spell-panel-progress" role="progressbar" aria-label="Prüfung läuft">
                <div className="spell-panel-progress-fill" />
              </div>
            </>
          ) : progress?.phase === 'load' ? (
            `Lade Spiele · ${progress.done} / ${progress.total}`
          ) : (
            'Wird geprüft…'
          )}
        </div>
      )}
      {!loading && !error && totalIssues === 0 && <div className="spell-panel-empty">{emptyText}</div>}

      {visibleGroups.map((group, gi) => {
        if (group.issues.length === 0) return null;
        const gkey = keyOf(group);
        // Only labeled groups can be collapsed (the per-game editor's single group has no label).
        const isCollapsible = !!group.groupLabel;
        const isCollapsed = isCollapsible && collapsed.has(gkey);
        return (
          <div className={`spell-group${isCollapsed ? ' spell-group--collapsed' : ''}`} key={gi}>
            {group.groupLabel && (
              <div className="spell-group-head">
                <button
                  type="button"
                  className="spell-group-toggle"
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? 'Ausklappen' : 'Einklappen'}
                  onClick={() => toggleGroup(gkey)}
                >
                  <svg className="spell-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {group.deepLink ? (
                  <button type="button" className="spell-group-link" onClick={group.deepLink}>
                    {group.groupLabel}
                  </button>
                ) : (
                  <span>{group.groupLabel}</span>
                )}
                <span className="spell-group-count">{group.issues.length}</span>
              </div>
            )}
            {!isCollapsed &&
              group.issues.map(issue => (
                <SpellIssueCard key={issue.id} issue={issue} onApply={onApply} onAllowWord={onAllowWord} onIgnore={onIgnore} />
              ))}
          </div>
        );
      })}
    </div>
  );
}
