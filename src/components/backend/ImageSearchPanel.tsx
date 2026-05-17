import { useCallback, useEffect, useState } from 'react';
import {
  searchImages,
  type ImageSearchResult,
} from '../../services/backendApi';

// Reusable multi-provider image search panel. Renders the search form, the
// candidate grid, the low-resolution filter pill, the partial-failure banner,
// and the "Mehr laden" button. The panel is render-state-free w.r.t. its
// parent — selection highlight and the click handler are passed in as props
// so it can drive both the "Ersetzen" flow (ReplaceImageModal) and the "Online
// suchen" upload flow (ImageSearchUploadModal).
//
// Owns: query, page, hasMore, results, partial errors, loading, low-res filter.
// Doesn't own: which candidate is "selected" (passed via `selectedUrl`), what
// happens on click (passed via `onSelect`).

interface Props {
  defaultQuery: string;
  // Frontend render box used by the low-resolution filter. Defaults to the
  // quiz-game box (1920 × 540) when omitted; pass the image-guess box
  // (1920 × 648) when the slot will render in that game.
  renderBox?: { w: number; h: number };
  // URL of the currently-selected candidate (drives the highlight ring).
  selectedUrl?: string;
  onSelect: (r: ImageSearchResult) => void;
  // Optional inline status badge shown over the selected candidate while a
  // parent-driven action (e.g. download, dry-run) is in flight.
  busyUrl?: string;
}

export default function ImageSearchPanel({
  defaultQuery,
  renderBox,
  selectedUrl,
  onSelect,
  busyUrl,
}: Props) {
  const [query, setQuery] = useState(defaultQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [searchPartial, setSearchPartial] = useState<Partial<Record<'ddg' | 'commons', string>>>({});
  const [searchError, setSearchError] = useState<string | null>(null);
  // Hide candidates that would be flagged as low-res in the matching render
  // box — same predicate the DAM uses for "Niedrige Auflösung". Default on
  // since the user almost always wants high-res candidates.
  const [hideSmallerResults, setHideSmallerResults] = useState(true);

  // `append: true` appends the new page's results (used by Mehr laden);
  // `append: false` replaces them (used by submitting a new query).
  const runSearch = useCallback(async (q: string, page = 1, append = false) => {
    setSearchLoading(true);
    setSearchError(null);
    if (!append) setSearchPartial({});
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

  return (
    <div className="replace-search">
      <form
        className="replace-search-form"
        onSubmit={e => {
          e.preventDefault();
          if (query.trim()) {
            setSearchPage(1);
            void runSearch(query.trim(), 1, false);
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
        <button type="submit" className="be-btn-primary" disabled={searchLoading || !query.trim()}>
          {searchLoading && searchResults.length === 0 ? 'Suche…' : '🔍 Suchen'}
        </button>
      </form>
      <div className="replace-search-toolbar">
        <span className="replace-search-sources">
          Quellen: DuckDuckGo · Wikimedia
        </span>
        {box && (
          <label className="replace-search-filter">
            <input
              type="checkbox"
              checked={hideSmallerResults}
              onChange={e => setHideSmallerResults(e.target.checked)}
            />
            <span>Niedrige Auflösung ausblenden</span>
            <span className="replace-search-filter-meta">
              (&lt; {box.w} × {box.h}px{hiddenCount > 0 ? ` · ${hiddenCount} verborgen` : ''})
            </span>
          </label>
        )}
      </div>
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
            onClick={() => onSelect(r)}
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
            {searchResults.length > 0
              ? 'Keine Treffer ≥ aktueller Auflösung — Filter deaktivieren um alle Ergebnisse zu sehen.'
              : query.trim() ? 'Keine Ergebnisse.' : 'Suchbegriff eingeben um Ergebnisse zu sehen.'}
          </div>
        )}
      </div>
      {searchHasMore && !searchError && query.trim() && (
        <button
          type="button"
          className="be-btn-secondary replace-search-more"
          onClick={() => void runSearch(query.trim(), searchPage + 1, true)}
          disabled={searchLoading}
        >
          {searchLoading ? 'Lade…' : `Mehr laden (Seite ${searchPage + 1})`}
        </button>
      )}
    </div>
  );
}
