/**
 * Presentational report panel for spellcheck results. Reused by the per-game check
 * (GameEditor) and the whole-show scan (LektoratTab). The host supplies grouped
 * issues + action callbacks; this component renders cards and wires the buttons.
 * See specs/spellcheck.md.
 */

import type { SpellMatch } from '@/services/backendApi';

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
  groupLabel?: string;
  deepLink?: () => void;
  issues: SpellIssue[];
}

interface Props {
  groups: SpellGroup[];
  loading?: boolean;
  progress?: { done: number; total: number } | null;
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
      {match.message && <div className="spell-issue-msg">{match.message}</div>}
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

  return (
    <div className="spell-panel">
      {error && <div className="spell-panel-error">{error}</div>}
      {loading && (
        <div className="spell-panel-status">
          Wird geprüft{progress ? ` · ${progress.done} / ${progress.total} Spiele` : '…'}
        </div>
      )}
      {!loading && !error && totalIssues === 0 && <div className="spell-panel-empty">{emptyText}</div>}

      {groups.map((group, gi) => {
        if (group.issues.length === 0) return null;
        return (
          <div className="spell-group" key={gi}>
            {group.groupLabel && (
              <div className="spell-group-head">
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
            {group.issues.map(issue => (
              <SpellIssueCard key={issue.id} issue={issue} onApply={onApply} onAllowWord={onAllowWord} onIgnore={onIgnore} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
