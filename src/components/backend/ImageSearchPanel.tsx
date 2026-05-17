import { useCallback, useEffect, useState } from 'react';
import {
  searchImages,
  type ImageSearchResult,
} from '../../services/backendApi';

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
  const [searchPartial, setSearchPartial] = useState<Partial<Record<'ddg' | 'commons', string>>>({});
  const [searchError, setSearchError] = useState<string | null>(null);

  // `append: true` appends the new page's results (used by Mehr laden);
  // `append: false` replaces them (used by submitting a new query).
  const runSearch = useCallback(async (q: string, page = 1, append = false) => {
    setSearchLoading(true);
    setSearchError(null);
    if (!append) {
      setSearchPartial({});
      setSubmittedQuery(q);
    }
    try {
      const resp = await searchImages(q, { page });
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
  }, []);

  // Auto-run an initial search when a default query is provided. With no
  // default (new-image upload flow), wait for the user to type one.
  useEffect(() => {
    if (defaultQuery.trim()) void runSearch(defaultQuery.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const box = renderBox;
  const filtered = (() => {
    if (!hideSmallerResults || !box) return searchResults;
    return searchResults.filter(r => {
      if (!r.width || !r.height) return true;
      return r.width >= box.w || r.height >= box.h;
    });
  })();
  const hiddenCount = searchResults.length - filtered.length;

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
      {Object.keys(searchPartial).length > 0 && (
        <div className="replace-search-partial">
          Teilweise verfügbar: {Object.keys(searchPartial).join(', ')} fehlgeschlagen
        </div>
      )}
      {searchError && <div className="replace-search-error">Fehler: {searchError}</div>}
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
              {r.source === 'ddg' ? 'DDG' : 'WIKI'}
            </span>
            {busyUrl === r.url && <span className="replace-candidate-busy">Lade…</span>}
          </button>
        ))}
        {!searchLoading && filtered.length === 0 && !searchError && (
          <div className="replace-search-empty">
            <span className="replace-search-empty-icon" aria-hidden>
              {searchResults.length > 0 ? '🔎' : submittedQuery ? '∅' : '🌐'}
            </span>
            <span className="replace-search-empty-text">
              {searchResults.length > 0
                ? 'Keine hochauflösenden Treffer — Filter deaktivieren, um alle Ergebnisse zu sehen.'
                : submittedQuery
                ? 'Keine Ergebnisse für diesen Suchbegriff.'
                : 'Suchbegriff eingeben, um nach Bildern zu suchen.'}
            </span>
          </div>
        )}
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
        Quellen: DuckDuckGo · Wikimedia
      </div>
    </div>
  );
}
