import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  searchImages,
  type ImageSearchResult,
  type ImageSearchProvider,
} from '../../services/backendApi';

// Provider filter pills shown above the search form. Order matches the
// orchestrator's preference (Logos first), so the labels read in the same
// order the user will see results.
const PROVIDER_FILTERS: ReadonlyArray<{ id: ImageSearchProvider; label: string }> = [
  { id: 'github-svg', label: 'Logos' },
  { id: 'ddg', label: 'DuckDuckGo' },
  { id: 'commons', label: 'Wikimedia' },
];
const ALL_PROVIDER_IDS = PROVIDER_FILTERS.map(p => p.id);
const PROVIDER_LABELS: Record<ImageSearchProvider, string> = {
  'github-svg': 'Logos',
  ddg: 'DuckDuckGo',
  commons: 'Wikimedia',
};

// Reusable multi-provider image search panel. Renders the search form, the
// candidate grid, the partial-failure banner, and the "Mehr laden" button.
// The panel is render-state-free w.r.t. its parent — selection highlight, the
// click handler, and the low-resolution filter toggle are all passed in as
// controlled props so it can drive both the "Ersetzen" flow (ReplaceImageModal)
// and the "Online suchen" upload flow (ImageSearchUploadModal).
//
// Owns: query, page, hasMore, results, partial errors, loading.
// Controlled: hideSmallerResults (filter toggle).
// Doesn't own: selected candidate, click handler.

// Small toggle component exported separately so parents can render it outside
// the panel (e.g. the upload modal places it next to the folder selector).
interface FilterToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  hiddenCount?: number;
}

export function ImageSearchFilterToggle({ checked, onChange, hiddenCount }: FilterToggleProps) {
  return (
    <label className="replace-search-filter">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span>Niedrige Auflösung ausblenden</span>
      {!!hiddenCount && hiddenCount > 0 && (
        <span className="replace-search-filter-meta">{hiddenCount} verborgen</span>
      )}
    </label>
  );
}

interface Props {
  defaultQuery: string;
  // Frontend render box used by the low-resolution filter. Defaults to the
  // quiz-game box (1920 × 540) when omitted; pass the image-guess box
  // (1920 × 648) when the slot will render in that game.
  renderBox?: { w: number; h: number };
  // URL of the currently-selected candidate (drives the highlight ring).
  selectedUrl?: string;
  // Receives the chosen candidate plus the submitted query the results belong
  // to, so callers that name downloaded files after the search term don't have
  // to lift query state out of the panel.
  onSelect: (r: ImageSearchResult, query: string) => void;
  // Optional inline status badge shown over the selected candidate while a
  // parent-driven action (e.g. download, dry-run) is in flight.
  busyUrl?: string;
  // Controlled low-res filter toggle.
  hideSmallerResults: boolean;
  onHideSmallerResultsChange: (v: boolean) => void;
  // When true, the panel renders its own inline filter toggle in the toolbar.
  // When false, the parent renders the toggle elsewhere (e.g. next to a
  // folder picker) and uses `onHiddenCountChange` to track the badge count.
  renderFilterToggle?: boolean;
  onHiddenCountChange?: (n: number) => void;
  // Fires when the user submits a *new* search (form submit), not on
  // auto-pagination or "Mehr laden" appends. Parents can use this to clear
  // any selection tied to the previous result set.
  onSearch?: (query: string) => void;
}

export default function ImageSearchPanel({
  defaultQuery,
  renderBox,
  selectedUrl,
  onSelect,
  busyUrl,
  hideSmallerResults,
  onHideSmallerResultsChange,
  renderFilterToggle = true,
  onHiddenCountChange,
  onSearch,
}: Props) {
  const [query, setQuery] = useState(defaultQuery);
  // `submittedQuery` is the query the currently-displayed results belong to.
  // Diverges from `query` while the user is typing a new search — we anchor
  // auto-pagination to it so we never append page N+1 of the new query onto
  // page N of the old one.
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [searchPartial, setSearchPartial] = useState<Partial<Record<ImageSearchProvider, string>>>({});
  const [searchError, setSearchError] = useState<string | null>(null);
  // Active provider set — controls which sources contribute to the next search.
  // Toggling re-runs the current search (or clears results if nothing remains).
  const [activeProviders, setActiveProviders] = useState<ReadonlySet<ImageSearchProvider>>(
    () => new Set(ALL_PROVIDER_IDS),
  );
  const activeProviderList = useMemo<ImageSearchProvider[]>(
    () => ALL_PROVIDER_IDS.filter(id => activeProviders.has(id)),
    [activeProviders],
  );

  // `append: true` appends the new page's results (used by Mehr laden);
  // `append: false` replaces them (used by submitting a new query).
  const runSearch = useCallback(async (q: string, page = 1, append = false, providers: ImageSearchProvider[] = activeProviderList) => {
    if (providers.length === 0) {
      // Nothing to query — clear the grid so the user sees what their toggle did.
      setSearchResults([]);
      setSearchPartial({});
      setSearchHasMore(false);
      setSubmittedQuery(q);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    if (!append) {
      setSearchPartial({});
      setSubmittedQuery(q);
    }
    try {
      const resp = await searchImages(q, { page, providers });
      setSearchPage(resp.page);
      setSearchHasMore(resp.hasMore);
      setSearchResults(prev => {
        if (!append) return resp.results;
        const seen = new Set(prev.map(r => r.url));
        return [...prev, ...resp.results.filter(r => !seen.has(r.url))];
      });
      setSearchPartial(resp.errors || {});
    } catch (err) {
      setSearchError((err as Error).message);
      if (!append) setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [activeProviderList]);

  // Auto-run an initial search when a default query is provided. With no
  // default (new-image upload flow), wait for the user to type one.
  useEffect(() => {
    if (defaultQuery.trim()) void runSearch(defaultQuery.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleProvider = useCallback((id: ImageSearchProvider) => {
    setActiveProviders(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't let the user disable the last remaining provider — otherwise
        // submitting a new search becomes a no-op with no recoverable UI.
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      const list = ALL_PROVIDER_IDS.filter(p => next.has(p));
      // Re-run the current search against the new provider set so the grid
      // reflects the toggle without forcing the user to hit "Suchen" again.
      if (submittedQuery) {
        setSearchPage(1);
        void runSearch(submittedQuery, 1, false, list);
      }
      return next;
    });
  }, [submittedQuery, runSearch]);

  const box = renderBox;
  // Client-side filter by active providers gives toggling instant visual feedback:
  // when the user disables a pill, that source's results disappear immediately
  // even though the re-fetch is still in flight in the background.
  const visibleByProvider = searchResults.filter(r => activeProviders.has(r.source));
  const filtered = (() => {
    if (!hideSmallerResults || !box) return visibleByProvider;
    return visibleByProvider.filter(r => {
      if (!r.width || !r.height) return true;
      return r.width >= box.w || r.height >= box.h;
    });
  })();
  const hiddenCount = visibleByProvider.length - filtered.length;

  // Report hiddenCount to the parent when the toggle is rendered externally,
  // so it can drive its own badge next to the externally-rendered checkbox.
  useEffect(() => {
    onHiddenCountChange?.(hiddenCount);
  }, [hiddenCount, onHiddenCountChange]);

  // When the filter hides results, auto-fetch additional pages so the grid
  // still feels populated. Stops at AUTO_FILL_MIN_VISIBLE, at the page cap,
  // or when the provider has no more pages — also halts while a fetch is in
  // flight or there's an error.
  const AUTO_FILL_MIN_VISIBLE = 12;
  const AUTO_FILL_MAX_PAGES = 5;
  useEffect(() => {
    if (!hideSmallerResults || !box) return;
    if (searchLoading || searchError) return;
    if (!searchHasMore) return;
    if (filtered.length >= AUTO_FILL_MIN_VISIBLE) return;
    if (searchPage >= AUTO_FILL_MAX_PAGES) return;
    if (!submittedQuery) return;
    void runSearch(submittedQuery, searchPage + 1, true);
  }, [hideSmallerResults, box, searchLoading, searchError, searchHasMore, filtered.length, searchPage, submittedQuery, runSearch]);

  return (
    <div className="replace-search">
      <div
        className={`replace-search-providers${searchLoading && submittedQuery ? ' is-loading' : ''}`}
        role="group"
        aria-label="Quellen filtern"
      >
        {PROVIDER_FILTERS.map(p => {
          const active = activeProviders.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`replace-search-provider-pill replace-search-provider-pill--${p.id}${active ? ' is-active' : ''}`}
              aria-pressed={active}
              aria-busy={active && searchLoading ? true : undefined}
              onClick={() => toggleProvider(p.id)}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <form
        className="replace-search-form"
        onSubmit={e => {
          e.preventDefault();
          const q = query.trim();
          if (q) {
            onSearch?.(q);
            setSearchPage(1);
            void runSearch(q, 1, false);
          }
        }}
      >
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Suchbegriff"
          className="replace-search-input"
          autoFocus
        />
        <button type="submit" className="be-btn-primary replace-search-submit" disabled={searchLoading || !query.trim()}>
          {searchLoading && searchResults.length === 0 ? 'Suche…' : '🔍 Suchen'}
        </button>
      </form>
      {renderFilterToggle && box && (
        <div className="replace-search-toolbar replace-search-toolbar--right">
          <ImageSearchFilterToggle
            checked={hideSmallerResults}
            onChange={onHideSmallerResultsChange}
            hiddenCount={hiddenCount}
          />
        </div>
      )}
      <div className="replace-results-area">
        {/* Banners live inside the fixed-height envelope so showing/hiding them
            doesn't grow the modal. They sit above the scroll region; the grid /
            empty-state takes whatever vertical space remains. */}
        {Object.keys(searchPartial).length > 0 && (
          <div className="replace-search-partial">
            Teilweise verfügbar: {(Object.keys(searchPartial) as ImageSearchProvider[]).map(p => PROVIDER_LABELS[p]).join(', ')} fehlgeschlagen
          </div>
        )}
        {searchError && <div className="replace-search-error">Fehler: {searchError}</div>}
        <div className="replace-results-scroll">
        {filtered.length > 0 ? (
          <div className="replace-candidate-grid">
            {filtered.map(r => (
              <button
                key={r.url}
                className={`replace-candidate${selectedUrl === r.url ? ' is-selected' : ''}${busyUrl === r.url ? ' is-busy' : ''}`}
                onClick={() => onSelect(r, submittedQuery)}
                type="button"
                title={r.title}
                disabled={!!busyUrl}
              >
                <img
                  src={r.thumbnailUrl || r.url}
                  alt={r.title || ''}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <span className="replace-candidate-dims">
                  {r.width && r.height ? `${r.width}×${r.height}` : '?'}
                </span>
                <span className={`replace-candidate-source replace-candidate-source--${r.source}`}>
                  {r.source === 'ddg' ? 'DDG' : r.source === 'commons' ? 'WIKI' : 'GH'}
                </span>
                {busyUrl === r.url && <span className="replace-candidate-busy">Lade…</span>}
              </button>
            ))}
          </div>
        ) : !searchError && (
          <div className="replace-search-empty">
            <span className="replace-search-empty-icon" aria-hidden>
              {searchLoading ? '⏳' : searchResults.length > 0 ? '🔎' : submittedQuery ? '∅' : '🌐'}
            </span>
            <span className="replace-search-empty-text">
              {searchLoading
                ? 'Suche läuft…'
                : searchResults.length > 0
                ? 'Keine hochauflösenden Treffer — Filter deaktivieren, um alle Ergebnisse zu sehen.'
                : submittedQuery
                ? 'Keine Ergebnisse für diesen Suchbegriff.'
                : 'Suchbegriff eingeben, um nach Bildern zu suchen.'}
            </span>
          </div>
        )}
        </div>
      </div>
      {searchHasMore && !searchError && submittedQuery && (
        <button
          type="button"
          className="be-btn-secondary replace-search-more"
          onClick={() => void runSearch(submittedQuery, searchPage + 1, true)}
          disabled={searchLoading}
        >
          {searchLoading ? 'Lade…' : `Mehr laden (Seite ${searchPage + 1})`}
        </button>
      )}
      <div className="replace-search-footer">
        Quellen: Logos · DuckDuckGo · Wikimedia
      </div>
    </div>
  );
}
