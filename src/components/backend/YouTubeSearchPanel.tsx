import { useCallback, useEffect, useRef, useState } from 'react';
import { isTouchDevice } from '@/utils/isTouchDevice';
import { searchYouTube, type YouTubeSearchResult } from '../../services/backendApi';

// Reusable single-provider YouTube search panel. Renders the search form, the
// result grid (16:9 video cards with title / channel / duration), and the
// "Mehr laden" pagination button. Models ImageSearchPanel, but YouTube has a
// single source so there are no provider pills or resolution filter.
//
// Owns: query, page, hasMore, results, loading, error.
// Doesn't own: selected candidate, click handler (controlled via props).

// Seconds → "m:ss" or "h:mm:ss".
function formatDuration(sec?: number): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

interface Props {
  defaultQuery?: string;
  // URL of the currently-selected candidate (drives the highlight ring).
  selectedUrl?: string;
  // Receives the chosen result plus the submitted query the results belong to.
  onSelect: (r: YouTubeSearchResult, query: string) => void;
  // Optional inline status badge over the selected card while a parent-driven
  // action (the download) is in flight.
  busyUrl?: string;
  // Fires when the user submits a *new* search (not on "Mehr laden" appends).
  onSearch?: (query: string) => void;
}

export default function YouTubeSearchPanel({
  defaultQuery = '',
  selectedUrl,
  onSelect,
  busyUrl,
  onSearch,
}: Props) {
  const [query, setQuery] = useState(defaultQuery);
  // `submittedQuery` is the query the currently-displayed results belong to.
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Tracks the in-flight request so a new search (or an explicit cancel) can
  // abort the previous one — yt-dlp searches take a few seconds, and the user
  // shouldn't have to wait for a typo's result before correcting it.
  const abortRef = useRef<AbortController | null>(null);

  // `append: true` appends the new page (Mehr laden); `false` replaces (new query).
  const runSearch = useCallback(async (q: string, p = 1, append = false) => {
    // Supersede any in-flight search: abort it so its stale result can never
    // overwrite the new one (and the server kills its yt-dlp process).
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    if (!append) setSubmittedQuery(q);
    try {
      const resp = await searchYouTube(q, { page: p, signal: ac.signal });
      if (ac.signal.aborted) return;
      setPage(resp.page);
      setHasMore(resp.hasMore);
      setResults(prev => {
        if (!append) return resp.results;
        const seen = new Set(prev.map(r => r.url));
        return [...prev, ...resp.results.filter(r => !seen.has(r.url))];
      });
    } catch (err) {
      if (ac.signal.aborted) return; // superseded or cancelled — ignore
      setError((err as Error).message);
      if (!append) setResults([]);
    } finally {
      // Only the most recent search owns the loading flag; a superseded one
      // must not flip it off while its replacement is still running.
      if (abortRef.current === ac) setLoading(false);
    }
  }, []);

  // Explicitly stop the current search without starting a new one.
  const cancelSearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  // Auto-run an initial search when a default query is provided; abort any
  // in-flight search when the panel unmounts (modal close).
  useEffect(() => {
    if (defaultQuery.trim()) void runSearch(defaultQuery.trim());
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="replace-search">
      <form
        className="replace-search-form"
        onSubmit={e => {
          e.preventDefault();
          const q = query.trim();
          if (q) {
            onSearch?.(q);
            setPage(1);
            void runSearch(q, 1, false);
          }
        }}
      >
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="YouTube durchsuchen"
          className="replace-search-input"
          autoFocus={!isTouchDevice()}
        />
        {/* Stays enabled while a search runs so the user can immediately re-search
            after fixing a typo — submitting aborts the in-flight query. */}
        <button type="submit" className="be-btn-primary replace-search-submit" disabled={!query.trim()}>
          🔍 Suchen
        </button>
        {loading && (
          <button
            type="button"
            className="be-btn-secondary replace-search-cancel"
            onClick={cancelSearch}
            title="Suche abbrechen"
            aria-label="Suche abbrechen"
          >
            ✕
          </button>
        )}
      </form>
      <div className="replace-results-area">
        {error && <div className="replace-search-error">Fehler: {error}</div>}
        <div className="replace-results-scroll">
          {results.length > 0 ? (
            <div className="replace-candidate-grid yt-candidate-grid">
              {results.map(r => {
                const dur = formatDuration(r.duration);
                return (
                  <button
                    key={r.url}
                    className={`yt-candidate${selectedUrl === r.url ? ' is-selected' : ''}${busyUrl === r.url ? ' is-busy' : ''}`}
                    onClick={() => onSelect(r, submittedQuery)}
                    type="button"
                    title={r.title}
                    disabled={!!busyUrl}
                  >
                    <span className="yt-candidate-thumb">
                      <img
                        src={r.thumbnailUrl}
                        alt={r.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      {dur && <span className="yt-candidate-duration">{dur}</span>}
                      {busyUrl === r.url && <span className="replace-candidate-busy">Lade…</span>}
                    </span>
                    <span className="yt-candidate-title">{r.title}</span>
                    {r.channel && <span className="yt-candidate-channel">{r.channel}</span>}
                  </button>
                );
              })}
            </div>
          ) : !error && (
            <div className="replace-search-empty">
              <span className="replace-search-empty-icon" aria-hidden>
                {loading ? '⏳' : submittedQuery ? '∅' : '🔎'}
              </span>
              <span className="replace-search-empty-text">
                {loading
                  ? 'Suche läuft…'
                  : submittedQuery
                  ? 'Keine Ergebnisse für diesen Suchbegriff.'
                  : 'Suchbegriff eingeben, um auf YouTube zu suchen.'}
              </span>
            </div>
          )}
        </div>
      </div>
      {hasMore && !error && submittedQuery && (
        <button
          type="button"
          className="be-btn-secondary replace-search-more"
          onClick={() => void runSearch(submittedQuery, page + 1, true)}
          disabled={loading}
        >
          {loading ? 'Lade…' : `Mehr laden (Seite ${page + 1})`}
        </button>
      )}
      <div className="replace-search-footer">Quelle: YouTube</div>
    </div>
  );
}
