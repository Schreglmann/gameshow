import { useState, useEffect, useRef, useMemo } from 'react';
import { isTouchDevice } from '@/utils/isTouchDevice';
import type { AppConfig, GameFileSummary, GameType, ContentChangedPayload } from '@/types/config';
import { fetchGames, fetchGame, fetchConfig, createGame, createExampleGames, deleteGame } from '@/services/backendApi';
import { buildOverlapContext, classifyGameOverlap, type Overlap } from '@/utils/playerStats';
import { OVERLAP_BADGE_GAME, OVERLAP_ORDER, gameRefs } from './overlapBadges';
import { useWsChannel } from '@/services/useBackendSocket';
import { gameSaveKey, discardSave, newerThanRead } from '@/services/saveQueue';
import { GAME_TYPE_INFO, GAME_TYPE_TEMPLATES, gameTypeMatchesQuery } from '@/data/gameTypeInfo';
import GameEditor from './GameEditor';
import StatusMessage from './StatusMessage';
import { slugifyGameName } from './slugifyGameName';
import { useConfirm } from './ConfirmContext';

interface NewGameModalProps {
  onCancel: () => void;
  onCreate: (fileName: string, title: string, type: GameType) => void;
}

function NewGameModal({ onCancel, onCreate }: NewGameModalProps) {
  const [gameName, setGameName] = useState('');
  const [selectedType, setSelectedType] = useState<GameType>('simple-quiz');

  const derived = slugifyGameName(gameName);

  const GAME_TYPES: GameType[] = ['simple-quiz', 'bet-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'video-guess', 'q1', 'four-statements', 'fact-or-fake', 'quizjagd', 'bandle', 'image-guess', 'colorguess', 'ranking', 'wer-kennt-mehr', 'random-frame', 'city-compass', 'venn', 'film-stripe'];

  const submit = () => {
    if (derived) onCreate(derived, gameName.trim(), selectedType);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        className="modal-box"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); submit(); }}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
      >
        <h2>Neues Spiel erstellen</h2>

        <label className="be-label">Name</label>
        <input
          className="be-input"
          value={gameName}
          onChange={e => setGameName(e.target.value)}
          placeholder="Mein neues Spiel"
          autoFocus
        />
        <label className="be-label" style={{ marginTop: 14 }}>Spieltyp</label>
        <div className="game-type-grid">
          {GAME_TYPES.map(type => (
            <button
              key={type}
              type="button"
              className={`game-type-option ${selectedType === type ? 'selected' : ''}`}
              onClick={() => setSelectedType(type)}
              data-tooltip={GAME_TYPE_INFO[type].description}
            >
              {GAME_TYPE_INFO[type].label}
            </button>
          ))}
        </div>

        <div className="be-actions">
          <button type="button" className="admin-button secondary" onClick={onCancel}>Abbrechen</button>
          <button
            type="submit"
            className="admin-button primary"
            disabled={!derived}
          >
            Erstellen
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Sort + status filter (see specs/admin-games-list.md) ─────────────────────

type SortKey = 'name' | 'type' | 'modified' | 'created' | 'status';
/**
 * The statuses the filter can narrow to; none selected = all games. `planned`
 * (Eingeplant) is left out: the status is classified FOR the active gameshow,
 * and Eingeplant only exists relative to a later one, so it never occurs here.
 */
type StatusKey = Exclude<Overlap, 'planned'>;

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  type: 'Typ',
  modified: 'Geändert',
  created: 'Erstellt',
  status: 'Status',
};

/** In status-sort order, labels as on the per-game badges (OVERLAP_BADGE_GAME). */
const STATUS_LABELS: Record<StatusKey, string> = {
  fresh: OVERLAP_BADGE_GAME.fresh.label,
  none: OVERLAP_BADGE_GAME.none.label,
  partial: OVERLAP_BADGE_GAME.partial.label,
  full: OVERLAP_BADGE_GAME.full.label,
};

interface ListPrefs {
  sort: SortKey;
  /** Flips the sort's natural direction (Name A→Z, dates newest first, Status Neu first). */
  reverse: boolean;
  status: StatusKey[];
}

/**
 * Sort + status filter, kept in module scope: it survives the pane unmounting on a
 * tab switch and resets on a page reload. See specs/admin-games-list.md.
 */
let listPrefs: ListPrefs = { sort: 'name', reverse: false, status: [] };

function storeListPrefs(next: ListPrefs): void {
  listPrefs = next;
}

/** Test hook: back to the defaults a page load starts with. */
export function resetGamesListPrefs(): void {
  storeListPrefs({ sort: 'name', reverse: false, status: [] });
}

const NO_STATUS_FILTER: readonly StatusKey[] = [];

function matchesStatus(overlap: Overlap | null, filter: readonly StatusKey[]): boolean {
  if (filter.length === 0) return true;
  return overlap !== null && (filter as readonly Overlap[]).includes(overlap);
}

function formatDate(ms: number | undefined): string {
  return ms ? new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

function formatDateTime(ms: number | undefined): string | undefined {
  return ms ? new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : undefined;
}

/** Display label of a game's type — what the Typ column shows and sorts by. */
function typeLabel(g: GameFileSummary): string {
  return g.parseError ? 'fehler' : (GAME_TYPE_INFO[g.type]?.label ?? g.type);
}

function matchesSearch(g: GameFileSummary, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return g.title.toLowerCase().includes(q) || g.fileName.toLowerCase().includes(q) || gameTypeMatchesQuery(g.type, search);
}

interface Props {
  onGoToAssets: () => void;
  initialFile?: string;
  initialInstance?: string;
  initialQuestion?: number;
  onNavigate: (file: string | null, instance?: string) => void;
}

export default function GamesTab({ onGoToAssets, initialFile, initialInstance, initialQuestion, onNavigate }: Props) {
  const confirmDialog = useConfirm();

  const [games, setGames] = useState<GameFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingExamples, setCreatingExamples] = useState(false);
  const [search, setSearch] = useState('');
  const [prefs, setPrefsState] = useState<ListPrefs>(listPrefs);
  const setPrefs = (update: (p: ListPrefs) => ListPrefs) => {
    const next = update(prefs);
    storeListPrefs(next);
    setPrefsState(next);
  };
  const [showSort, setShowSort] = useState(false);
  // Gameshows + active gameshow, for the Neu/Ungespielt status (specs/admin-games-list.md).
  const [config, setConfig] = useState<Pick<AppConfig, 'gameshows' | 'activeGameshow'> | null>(null);
  // Capture initialQuestion in a ref so it survives onNavigate clearing the parent state
  const questionRef = useRef(initialQuestion);
  const [editingFile, setEditingFile] = useState<string | null>(null);
   
  const [editingData, setEditingData] = useState<Record<string, any> | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    fetchGames()
      .then(setGames)
      .catch(e => showMsg('error', `Fehler: ${e.message}`))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const loadConfig = () => {
    fetchConfig()
      .then(c => setConfig({ gameshows: c.gameshows, activeGameshow: c.activeGameshow }))
      .catch(() => { /* status column stays hidden */ });
  };
  useEffect(loadConfig, []);

  // Restore editor state on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialFile) openEditor(initialFile, initialInstance); }, []);

  // Sync with parent navigation (browser back/forward)
  useEffect(() => {
    if (!initialFile && editingFile) {
      // Back to games list
      setEditingFile(null);
      setEditingData(null);
      load();
    } else if (initialFile && initialFile !== editingFile) {
      // Back/forward to a different game
      openEditor(initialFile, initialInstance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // Live refresh from another admin instance: keep the game list in sync (games added,
  // deleted or renamed elsewhere) without the loading spinner. The open editor, if any,
  // reconciles itself — see GameEditor + specs/live-config-reload.md.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (payload?.games) {
      fetchGames().then(setGames).catch(() => { /* keep current list on transient error */ });
    }
    if (payload?.config) loadConfig();
  });

  // Status of every game against the active gameshow — the same per-game badge the
  // gameshow's "Spiel hinzufügen…" picker shows. `null` from classifyGameOverlap
  // (no roster, played before) counts as Ungespielt. See specs/admin-games-list.md.
  const activeShow = config?.gameshows?.[config.activeGameshow];
  const statusByFile = useMemo(() => {
    const map = new Map<string, Overlap | null>();
    if (!config || !activeShow) return map;
    const ctx = buildOverlapContext(config.gameshows, config.activeGameshow, activeShow.players ?? [], config.activeGameshow);
    for (const g of games) {
      map.set(g.fileName, g.parseError ? null : (classifyGameOverlap(gameRefs(g), ctx) ?? 'none'));
    }
    return map;
  }, [games, config, activeShow]);
  const hasStatus = !!activeShow;
  const effectiveSort: SortKey = !hasStatus && prefs.sort === 'status' ? 'name' : prefs.sort;
  const effectiveFilter: readonly StatusKey[] = hasStatus ? prefs.status : NO_STATUS_FILTER;
  const sortReverse = prefs.reverse;

  const visibleGames = useMemo(() => {
    const byTitle = (a: GameFileSummary, b: GameFileSummary) =>
      a.title.localeCompare(b.title, 'de') || a.fileName.localeCompare(b.fileName, 'de');
    const list = games.filter(g =>
      matchesSearch(g, search) && matchesStatus(statusByFile.get(g.fileName) ?? null, effectiveFilter),
    );
    const statusRank = (g: GameFileSummary) => {
      const o = statusByFile.get(g.fileName);
      return o ? OVERLAP_ORDER[o] : Number.MAX_SAFE_INTEGER;
    };
    const dir = sortReverse ? -1 : 1;
    return list.sort((a, b) => {
      switch (effectiveSort) {
        case 'modified': return dir * ((b.modifiedAt ?? 0) - (a.modifiedAt ?? 0)) || byTitle(a, b);
        case 'created': return dir * ((b.createdAt ?? 0) - (a.createdAt ?? 0)) || byTitle(a, b);
        case 'status': return dir * (statusRank(a) - statusRank(b)) || byTitle(a, b);
        case 'type': return dir * typeLabel(a).localeCompare(typeLabel(b), 'de') || byTitle(a, b);
        default: return dir * byTitle(a, b);
      }
    });
  }, [games, search, statusByFile, effectiveFilter, effectiveSort, sortReverse]);
  // The date column only appears under a date sort, showing that sort's date.
  const dateField: 'modifiedAt' | 'createdAt' | null =
    effectiveSort === 'created' ? 'createdAt' : effectiveSort === 'modified' ? 'modifiedAt' : null;
  const dateLabel = dateField === 'createdAt' ? 'Erstellt' : 'Geändert';

  /** Pick a sort; picking the active one again reverses it (menu + column headings). */
  const chooseSort = (k: SortKey) => setPrefs(p => (
    effectiveSort === k ? { ...p, reverse: !p.reverse } : { ...p, sort: k, reverse: false }
  ));

  /** A clickable column heading that sorts by `k`. */
  const sortHeading = (k: SortKey, label: string) => {
    const active = effectiveSort === k;
    return (
      <button
        type="button"
        className={`games-sort-heading${active ? ' is-sorted' : ''}`}
        onClick={() => chooseSort(k)}
        title={active ? 'Sortierung umkehren' : `Nach ${SORT_LABELS[k]} sortieren`}
        aria-sort={active ? (sortReverse ? 'descending' : 'ascending') : undefined}
      >
        {label}
        {active && <span aria-hidden="true">{sortReverse ? ' ↑' : ' ↓'}</span>}
      </button>
    );
  };

  const openEditor = async (fileName: string, instance?: string) => {
    try {
      const startedAt = Date.now();
      const disk = await fetchGame(fileName);
      // Reopening a game whose last edit is still queued (or landed while this GET was in
      // flight) must not hand the editor the pre-edit file — see specs/admin-save-queue.md.
      const data = newerThanRead<Record<string, unknown>>(gameSaveKey(fileName), startedAt)
        ?? (disk as Record<string, unknown>);
      setEditingData(data as Record<string, unknown>);
      setEditingFile(fileName);
      onNavigate(fileName, instance);
    } catch (e) {
      showMsg('error', `Fehler beim Laden: ${(e as Error).message}`);
    }
  };

  const handleInstanceChange = (instance: string) => {
    if (editingFile) onNavigate(editingFile, instance);
  };

  const handleDelete = async (fileName: string) => {
    if (!(await confirmDialog({ title: `Spiel "${fileName}" wirklich löschen?` }))) return;
    // Drop any queued save for this file first — a pending write would recreate it.
    discardSave(gameSaveKey(fileName));
    try {
      const result = await deleteGame(fileName);
      const removedCount = result?.removedRefs?.length ?? 0;
      const suffix = removedCount
        ? ` — aus ${removedCount} Gameshow-Verweis(en) entfernt`
        : '';
      showMsg('success', `🗑️ "${fileName}" gelöscht${suffix}`);
      load();
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    }
  };

  const handleCreate = async (fileName: string, title: string, type: GameType) => {
    try {
      const template = { ...GAME_TYPE_TEMPLATES[type], title };
      await createGame(fileName, template);
      setShowNewModal(false);
      const data = await fetchGame(fileName);
      setEditingData(data as Record<string, unknown>);
      setEditingFile(fileName);
      load();
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    }
  };

  const handleCreateExamples = async () => {
    setCreatingExamples(true);
    try {
      const result = await createExampleGames();
      showMsg('success', `✅ ${result.createdGames.length} Beispiele erstellt`);
      load();
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    } finally {
      setCreatingExamples(false);
    }
  };

  const handleRename = (newFileName: string) => {
    setEditingFile(newFileName);
    onNavigate(newFileName);
    load();
  };

  if (editingFile && editingData) {
    return (
      <GameEditor
        fileName={editingFile}
        initialData={editingData}
        initialInstance={initialInstance}
        initialQuestion={questionRef.current}
        onInstanceChange={handleInstanceChange}
        onClose={() => { setEditingFile(null); setEditingData(null); onNavigate(null); load(); }}
        onGoToAssets={onGoToAssets}
        onRename={handleRename}
      />
    );
  }

  return (
    <div>
      <StatusMessage message={message} />

      <div className="tab-toolbar" style={{ marginBottom: 10 }}>
        <h2 className="tab-title">Spiele</h2>
        <div className="games-toolbar">
          <input
            className="be-input games-toolbar-search"
            placeholder="Suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && visibleGames.length === 1 && !visibleGames[0]!.parseError) {
                openEditor(visibleGames[0]!.fileName);
              }
            }}
            autoFocus={!isTouchDevice()}
          />
          {/* One sort + filter control, same as the Assets tab's. */}
          <div className="asset-sort-wrapper games-toolbar-sort">
            <button
              className={`be-icon-btn${showSort ? ' asset-select-toggle-active' : ''}`}
              onClick={() => setShowSort(v => !v)}
              title="Sortierung und Filter"
              aria-label="Sortierung und Filter"
              aria-expanded={showSort}
            >
              {SORT_LABELS[effectiveSort]}
              {sortReverse ? ' ↑' : ' ↓'}
              {effectiveFilter.length > 0 && (
                <span className="games-sort-filter-label">
                  {` · ${(Object.keys(STATUS_LABELS) as StatusKey[]).filter(k => effectiveFilter.includes(k)).map(k => STATUS_LABELS[k]).join(' + ')}`}
                </span>
              )}
            </button>
            {showSort && (
              <>
                <div className="asset-sort-backdrop" onClick={() => setShowSort(false)} />
                <div className="asset-sort-popover" role="menu">
                  <div className="asset-sort-section-label">Sortierung</div>
                  {(Object.keys(SORT_LABELS) as SortKey[])
                    .filter(k => k !== 'status' || hasStatus)
                    .map(k => (
                      <button
                        key={k}
                        role="menuitemradio"
                        aria-checked={effectiveSort === k}
                        className={`asset-sort-btn${effectiveSort === k ? ' active' : ''}`}
                        onClick={() => chooseSort(k)}
                      >
                        {SORT_LABELS[k]}
                        {effectiveSort === k && <span className="asset-sort-arrow">{sortReverse ? ' ↑' : ' ↓'}</span>}
                      </button>
                    ))}
                  {hasStatus && (
                    <>
                      <div className="asset-sort-divider" />
                      <div className="asset-sort-section-label" title={`Status bezogen auf die aktive Gameshow „${activeShow!.name}“`}>Filter</div>
                      {(Object.keys(STATUS_LABELS) as StatusKey[]).map(k => {
                        const on = effectiveFilter.includes(k);
                        return (
                          <button
                            key={k}
                            role="menuitemcheckbox"
                            aria-checked={on}
                            className={`asset-sort-btn${on ? ' active' : ''}`}
                            onClick={() => setPrefs(p => ({
                              ...p,
                              status: on ? p.status.filter(x => x !== k) : [...p.status, k],
                            }))}
                          >
                            {STATUS_LABELS[k]}
                            {on && <span className="asset-sort-arrow">✓</span>}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <button className="admin-button primary" style={{ marginTop: 0 }} onClick={() => setShowNewModal(true)}>
            + Neues Spiel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="be-loading">Lade Spiele...</div>
      ) : games.length === 0 ? (
        <div className="be-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <p style={{ margin: 0 }}>Noch keine Spiele vorhanden.</p>
          <button
            className="admin-button primary"
            onClick={handleCreateExamples}
            disabled={creatingExamples}
          >
            {creatingExamples ? 'Erstelle Beispiele…' : 'Beispiele erstellen'}
          </button>
          <p style={{ margin: 0, fontSize: 'clamp(0.8rem, 1.6vw, 0.9rem)', opacity: 0.7, maxWidth: 420, textAlign: 'center' }}>
            Legt für jede Spielart ein Beispielspiel mit echten Fragen an – inklusive selbst erzeugter, lizenzfreier Bilder und Musik.
          </p>
        </div>
      ) : (
        <div className="games-list">
          <div className="games-list-header">
            <span style={{ flex: 1 }}>{sortHeading('name', 'Titel')}</span>
            {hasStatus && <span className="games-col-status">{sortHeading('status', 'Status')}</span>}
            <span className="games-col-type">{sortHeading('type', 'Typ')}</span>
            <span className="games-col-instances">Instanzen</span>
            {dateField && <span className="games-col-date">{sortHeading(dateField === 'createdAt' ? 'created' : 'modified', dateLabel)}</span>}
            <span style={{ width: 32 }}></span>
          </div>
          {visibleGames.length === 0 && (
            <div className="be-empty" style={{ padding: '12px 0' }}>Keine Spiele gefunden</div>
          )}
          {visibleGames.map(game => {
            const overlap = statusByFile.get(game.fileName) ?? null;
            const badge = overlap ? OVERLAP_BADGE_GAME[overlap] : null;
            return (
            <div
              key={game.fileName}
              className={`games-list-row${game.parseError ? ' games-list-row--error' : ''}`}
              onClick={() => !game.parseError && openEditor(game.fileName)}
              title={game.parseError ? `JSON-Fehler: ${game.parseError}` : undefined}
            >
              <span className="games-list-title">
                {game.title}
                {game.parseError && <span className="parse-error-badge">JSON-Fehler</span>}
              </span>
              {hasStatus && (
                <span className="games-col-status">
                  {badge && <span className={`overlap-badge ${badge.className}`} title={badge.title}>{badge.label}</span>}
                </span>
              )}
              <span className="games-col-type"><span className="type-badge" title={typeLabel(game)}>{typeLabel(game)}</span></span>
              <span className="games-col-instances games-list-instances">
                {game.isSingleInstance ? '—' : game.instances.filter(i => i !== 'template').join(', ')}
              </span>
              {dateField && (
                <span className="games-col-date games-list-date" title={formatDateTime(game[dateField])}>{formatDate(game[dateField])}</span>
              )}
              <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, flexShrink: 0 }}>
                <button className="be-delete-btn" onClick={() => handleDelete(game.fileName)} title="Löschen">🗑</button>
              </span>
            </div>
            );
          })}
        </div>
      )}

      {showNewModal && (
        <NewGameModal
          onCancel={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
