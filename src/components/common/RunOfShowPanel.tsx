import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchRunOfShow } from '@/services/api';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterAnswer, useGamemasterControls, useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import { useWsChannel } from '@/services/useBackendSocket';
import { hasGlobalRulesContent } from '@/utils/globalRules';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';
import GmConfirmDialog from '@/components/common/GmConfirmDialog';
import type { ContentChangedPayload, RunOfShowEntry } from '@/types/config';

/**
 * One jumpable position in the show. `key` doubles as the `goto:` command
 * target, so the command vocabulary and the row list can never drift apart.
 */
interface Row {
  key: string;
  /** Small leading marker: the game number, or '·' for the framing screens. */
  marker: string;
  label: string;
  /** Secondary line — the game-type label, or the missing-ref hint. */
  sublabel?: string;
  missing?: boolean;
}

/**
 * Whether the operator has expanded the panel to the full running order.
 * Device-local UI state, persisted directly rather than through the reducer —
 * the same documented exception as the GM lock / answer-visibility flags
 * (AGENTS.md §3). Deliberately NOT synced: one gamemaster device wanting the
 * long list says nothing about what another device wants.
 */
const EXPANDED_STORAGE_KEY = 'gm-ablauf-expanded';

function readStoredExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** The `screenLabel` each framing screen broadcasts on `gamemaster-answer`. */
const SCREEN_LABEL_TO_KEY: Record<string, string> = {
  'Startseite': 'home',
  'Globale Regeln': 'rules',
  'Zusammenfassung': 'summary',
};

interface Props {
  /** Drawer state — only meaningful below the 1280px sidebar breakpoint. */
  open: boolean;
  onClose: () => void;
  /** Raised while the drawer or the confirm dialog is open, so `GamemasterScreen`
   *  can suppress its document-level click/key navigation. */
  onOverlayActiveChange: (active: boolean) => void;
}

/**
 * The gamemaster's "Ablauf" panel: the whole running order, where the show is,
 * and a confirmed jump to any entry. See specs/gamemaster-run-of-show.md.
 */
export default function RunOfShowPanel({ open, onClose, onOverlayActiveChange }: Props) {
  const { state } = useGameContext();
  const answer = useGamemasterAnswer();
  const controls = useGamemasterControls();
  const sendCommand = useSendGamemasterCommand();

  const [games, setGames] = useState<RunOfShowEntry[] | null>(null);
  const [pending, setPending] = useState<Row | null>(null);
  const [expanded, setExpanded] = useState<boolean>(readStoredExpanded);

  const toggleExpanded = useCallback(() => {
    setExpanded(prev => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        /* localStorage unavailable — keep in-memory state */
      }
      return next;
    });
  }, []);

  const load = useCallback(() => {
    fetchRunOfShow()
      .then(res => setGames(res.games))
      // A failed fetch leaves the last good list up rather than blanking the
      // panel mid-show; the next content-changed or reload retries.
      .catch(() => setGames(prev => prev));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep the list live: an admin edit to gameOrder (or a game's title) reaches
  // the panel without a reload, the same way GameScreen refreshes the running
  // game. See specs/live-config-reload.md.
  useWsChannel<ContentChangedPayload>('content-changed', payload => {
    if (payload?.config || payload?.games) load();
  });

  // The rules screen auto-forwards to game 0 when it has nothing to show, so
  // offering it would be a dead jump.
  const showRulesRow = hasGlobalRulesContent(state.settings);

  const rows = useMemo<Row[]>(() => {
    const gameRows: Row[] = (games ?? []).map(g => ({
      key: `game-${g.index}`,
      marker: String(g.index + 1),
      label: g.title,
      sublabel: g.missing ? 'Referenz nicht gefunden' : (g.type ? GAME_TYPE_INFO[g.type]?.label : undefined),
      missing: g.missing,
    }));
    return [
      { key: 'home', marker: '·', label: 'Startseite' },
      ...(showRulesRow ? [{ key: 'rules', marker: '·', label: 'Regelwerk' }] : []),
      ...gameRows,
      { key: 'summary', marker: '·', label: 'Zusammenfassung' },
    ];
  }, [games, showRulesRow]);

  // Where the show is. The framing screens identify themselves by `screenLabel`
  // on `gamemaster-answer`; inside a game, `gamemaster-controls.gameIndex` is
  // authoritative (it is also correct on a game's landing screen, where it names
  // the game whose title is showing).
  const screenKey = answer?.screenLabel ? SCREEN_LABEL_TO_KEY[answer.screenLabel] : undefined;
  const currentKey = screenKey
    ?? (typeof controls?.gameIndex === 'number' ? `game-${controls.gameIndex}` : null);

  const currentPos = currentKey ? rows.findIndex(r => r.key === currentKey) : -1;

  // Size the collapsed list to EXACTLY the three window rows (previous, current,
  // next) and rest with the first of them flush to the top. A fixed pixel cap
  // ended mid-row and left a half-clipped pill at the bottom edge; rows vary in
  // height (one- vs two-line titles), so the height has to be measured.
  //
  // The measurement is published as a custom property and consumed by CSS only
  // in the collapsed gutter regime — that keeps the layout regime a pure CSS
  // concern here, with no matchMedia duplicate of the 1280px boundary.
  //
  // Everything below the window is still reachable by scrolling; expanding drops
  // the cap entirely.
  //
  // Measured with rects, not `offsetTop`: the list is not a positioned element,
  // so a row's `offsetTop` is relative to the nearest positioned ancestor (the
  // whole gamemaster screen) and would scroll the list to its end.
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const apply = () => {
      const windowItems = list.querySelectorAll<HTMLLIElement>('.gm-runofshow-item--window');
      const first = windowItems[0];
      const last = windowItems[windowItems.length - 1];
      if (!first || !last) return;

      // One row gap of headroom above and below the window, so the box does not
      // stop flush against a pill edge — the same rhythm that separates the
      // pills continues past them, reading as "there is more just outside".
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const rows3 = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
      list.style.setProperty('--gm-runofshow-window-h', `${Math.ceil(rows3 + 2 * gap)}px`);

      // Rest position: from the top of the unscrolled list, the distance down to
      // the window's first row, less that one gap of headroom. Derived at
      // scrollTop 0 so it never compounds across re-runs.
      list.scrollTop = 0;
      const viewportTop = list.getBoundingClientRect().top + list.clientTop;
      const offset = first.getBoundingClientRect().top - viewportTop;
      list.scrollTop = Math.max(0, offset - gap);
    };

    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [currentKey, rows.length, open, expanded]);

  // The drawer and the dialog both count as an open overlay.
  useEffect(() => {
    onOverlayActiveChange(open || pending !== null);
  }, [open, pending, onOverlayActiveChange]);

  // Escape closes the drawer. Skipped while the dialog is up — it owns Escape
  // (and stops propagation), so closing both at once is not possible anyway.
  useEffect(() => {
    if (!open || pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending, onClose]);

  const confirmJump = useCallback(() => {
    if (pending) sendCommand(`goto:${pending.key}`);
    setPending(null);
    onClose();
  }, [pending, sendCommand, onClose]);

  return (
    <>
      {open && <div className="gm-runofshow-backdrop" onClick={onClose} data-gm-no-nav />}
      <nav
        className={
          'gm-runofshow'
          + (open ? ' gm-runofshow--open' : '')
          + (expanded ? ' gm-runofshow--expanded' : '')
        }
        aria-label="Ablauf der Show"
        data-gm-no-nav
      >
        <div className="gm-runofshow-header">
          <span className="gm-runofshow-heading">Ablauf</span>
          <button
            type="button"
            className="gm-runofshow-expand"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            title={
              expanded
                ? 'Nur das vorherige, aktuelle und nächste Spiel zeigen.'
                : 'Alle Spiele zeigen, ohne zu scrollen.'
            }
            aria-label={expanded ? 'Ablauf einklappen' : 'Alle Spiele zeigen'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {expanded ? (
                <><polyline points="4 14 12 6 20 14" /><polyline points="4 20 12 12 20 20" /></>
              ) : (
                <><polyline points="4 10 12 18 20 10" /><polyline points="4 4 12 12 20 4" /></>
              )}
            </svg>
          </button>
          <button
            type="button"
            className="gm-runofshow-close"
            onClick={onClose}
            aria-label="Ablauf schließen"
          >
            ✕
          </button>
        </div>
        {/* The bordered box is a WRAPPER, not the scroller: padding on a scroll
            container is not empty space — content scrolls up through it, so a
            neighbouring pill intrudes into the inset. Keeping the frame outside
            the scroller means the visible region is exactly the list. */}
        <div className="gm-runofshow-listbox">
        <ul className="gm-runofshow-list" ref={listRef}>
          {rows.map((row, i) => {
            const isCurrent = row.key === currentKey;
            const isPast = currentPos >= 0 && i < currentPos;
            const disabled = isCurrent || row.missing;
            // The three entries the collapsed gutter panel shows: previous,
            // current, next. With no known position, the first three. CSS hides
            // the rest — marking them here keeps the collapsed panel free of a
            // half-clipped row without a second, JS-side notion of the layout
            // regime (the drawer always shows everything).
            const windowStart = currentPos >= 0 ? Math.max(0, currentPos - 1) : 0;
            const inWindow = i >= windowStart && i < windowStart + 3;
            return (
              <li key={row.key} className={inWindow ? 'gm-runofshow-item--window' : undefined}>
                <button
                  type="button"
                  className={
                    'gm-runofshow-row'
                    + (isCurrent ? ' gm-runofshow-row--current' : '')
                    + (isPast ? ' gm-runofshow-row--past' : '')
                    + (row.missing ? ' gm-runofshow-row--missing' : '')
                  }
                  disabled={disabled}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => setPending(row)}
                  title={
                    isCurrent ? 'Die Show ist gerade hier'
                      : row.missing ? 'Dieses Spiel konnte nicht geladen werden'
                        : `Zu «${row.label}» springen`
                  }
                >
                  <span className="gm-runofshow-marker">{row.marker}</span>
                  <span className="gm-runofshow-text">
                    <span className="gm-runofshow-label">{row.label}</span>
                    {row.sublabel && <span className="gm-runofshow-sublabel">{row.sublabel}</span>}
                  </span>
                  {/* No "Jetzt"/"Danach" markers: the current row's highlight
                      already says where the show is, and the next row is simply
                      the one below it. "Fehlt" stays — it reports a broken
                      reference, which position alone cannot convey. */}
                  {row.missing && <span className="gm-runofshow-badge gm-runofshow-badge--missing">Fehlt</span>}
                </button>
              </li>
            );
          })}
        </ul>
        </div>
      </nav>
      {pending && (
        <GmConfirmDialog
          title={`Zu «${pending.label}» springen?`}
          description={
            <>
              Das laufende Spiel wird verlassen und «{pending.label}» startet von vorne.
              <br />
              Bereits vergebene Punkte bleiben erhalten.
            </>
          }
          onConfirm={confirmJump}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
