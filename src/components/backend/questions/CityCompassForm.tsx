import { useEffect, useMemo, useRef, useState } from 'react';
import type { CityCompassQuestion, CompassCity } from '@/types/config';
import {
  DEFAULT_NEIGHBOR_COUNT,
  MIN_NEIGHBOR_COUNT,
  MAX_NEIGHBOR_COUNT,
  MAX_NEIGHBOR_DISTANCE_KM,
  formatDistanceKm,
  haversineKm,
  initialBearingDeg,
  pickNeighbors,
  type City,
  type CompassDifficulty,
} from '@/utils/cityCompass';
import CompassRose from '@/components/common/CompassRose';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty as stripTrailingEmptyQuestions } from './ghostRow';
import { useConfirm } from '../ConfirmContext';

interface Props {
  questions: CityCompassQuestion[];
  onChange: (questions: CityCompassQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
  /** Instance setting: append the distance to each label. Undefined means the default (off). */
  showDistances?: boolean;
  /** Instance setting: reveal all neighbors at once, or one per host advance. */
  reveal?: 'all' | 'progressive';
  /** Both setters store `undefined` for the default, so the JSON stays clean. */
  onChangeShowDistances: (value: boolean | undefined) => void;
  onChangeReveal: (value: 'all' | 'progressive' | undefined) => void;
}

const EMPTY_CITY: CompassCity = { name: '', lat: 0, lon: 0 };

const empty = (): CityCompassQuestion => ({ center: { ...EMPTY_CITY }, neighbors: [] });
const isEmptyQuestion = (q: CityCompassQuestion) =>
  !q.center?.name?.trim() && (q.neighbors?.length ?? 0) === 0 && !q.question?.trim() && !q.info?.trim();

/**
 * The 2846-city table is ~107 KB and only the compass editor needs it, so it is
 * pulled in on demand rather than bundled into the admin entry point. The promise is
 * module-level, so opening a second question does not fetch it again.
 */
let datasetPromise: Promise<City[]> | null = null;
function loadCities(): Promise<City[]> {
  datasetPromise ??= import('@/data/cities.generated').then(m => m.CITIES);
  return datasetPromise;
}

function useCityDataset(): City[] | null {
  const [cities, setCities] = useState<City[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadCities().then(loaded => {
      if (alive) setCities(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);
  return cities;
}

function formatPopulation(population: number): string {
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1).replace('.', ',')} Mio`;
  return population.toLocaleString('de-DE');
}

const TIER_RANK: Record<City['tier'], number> = { capital: 0, metro: 1, major: 2, local: 3 };

interface CitySearchProps {
  placeholder: string;
  /** Names already used in this question, so the list never offers a duplicate. */
  taken: string[];
  onPick: (city: City) => void;
}

/**
 * Typeahead over the city dataset. Keyboard handling matches the players and game
 * comboboxes in GameshowEditor.tsx: arrows move the highlight, Enter takes it (or the
 * only match, so a unique name needs no arrow key at all), Escape closes.
 */
function CitySearch({ placeholder, taken, onPick }: CitySearchProps) {
  const cities = useCityDataset();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hlIndex, setHlIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!cities || q.length < 2) return [];
    const takenSet = new Set(taken);
    return cities
      .filter(c => !takenSet.has(c.name) && c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // A city whose name starts with the query is almost always the one meant.
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.population - a.population;
      })
      .slice(0, 12);
  }, [cities, query, taken]);

  // Twelve results do not fit the dropdown's height, so arrowing past the visible
  // ones has to bring them into view.
  useEffect(() => {
    if (hlIndex < 0) return;
    listRef.current?.children[hlIndex]?.scrollIntoView({ block: 'nearest' });
  }, [hlIndex]);

  const pick = (city: City) => {
    onPick(city);
    setQuery('');
    setOpen(false);
    setHlIndex(-1);
  };

  const visible = open && results.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visible) setHlIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visible) setHlIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!visible) return;
      if (hlIndex >= 0 && hlIndex < results.length) pick(results[hlIndex]!);
      else if (results.length === 1) pick(results[0]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setHlIndex(-1);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="city-search">
      <input
        ref={inputRef}
        className="be-input"
        value={query}
        placeholder={cities ? placeholder : 'Städte werden geladen…'}
        disabled={!cities}
        role="combobox"
        aria-expanded={visible}
        aria-controls="city-search-list"
        aria-autocomplete="list"
        onChange={e => { setQuery(e.target.value); setOpen(true); setHlIndex(-1); }}
        onFocus={() => setOpen(true)}
        // Delayed so a click on a result lands before the list unmounts.
        onBlur={() => setTimeout(() => { setOpen(false); setHlIndex(-1); }, 120)}
        onKeyDown={handleKeyDown}
      />
      {visible && (
        <div className="city-search-results" id="city-search-list" role="listbox" ref={listRef}>
          {results.map((city, i) => (
            <button
              key={`${city.name}|${city.country}`}
              type="button"
              role="option"
              aria-selected={i === hlIndex}
              className={`city-search-result${i === hlIndex ? ' highlighted' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(city); }}
              onMouseEnter={() => setHlIndex(i)}
            >
              <span className="city-search-result__name">{city.name}</span>
              <span className="city-search-result__meta">
                {city.country} · {formatPopulation(city.population)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DIFFICULTY_LABELS: Record<CompassDifficulty, string> = {
  easy: 'Leicht',
  normal: 'Normal',
  hard: 'Schwer',
};

export default function CityCompassForm({
  questions,
  onChange,
  otherInstances,
  onMoveQuestion,
  showDistances,
  reveal,
  onChangeShowDistances,
  onChangeReveal,
}: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const cities = useCityDataset();
  const displayQuestions = [...questions, empty()];

  /** Auto settings are editor state, not content — they never reach the game JSON. */
  const [autoCount, setAutoCount] = useState(DEFAULT_NEIGHBOR_COUNT);
  const [difficulty, setDifficulty] = useState<CompassDifficulty>('normal');
  const [seeds, setSeeds] = useState<Record<number, number>>({});

  const update = (i: number, patch: Partial<CityCompassQuestion>) => {
    let next: CityCompassQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i]!, ...patch };
    }
    onChange(stripTrailingEmptyQuestions(next, isEmptyQuestion));
  };

  const remove = async (i: number) => {
    if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i));
  };

  const duplicate = (i: number) => {
    const next = [...questions];
    const src = questions[i]!;
    next.splice(i + 1, 0, { ...src, center: { ...src.center }, neighbors: src.neighbors.map(c => ({ ...c })) });
    onChange(next);
  };

  const toCompassCity = (city: City): CompassCity => ({
    name: city.name,
    lat: city.lat,
    lon: city.lon,
    country: city.country,
  });

  const setNeighbors = (i: number, neighbors: CompassCity[]) => update(i, { neighbors });

  const addNeighbor = (i: number, city: City) => {
    const base = i >= questions.length ? empty() : questions[i]!;
    setNeighbors(i, [...base.neighbors, toCompassCity(city)]);
  };

  const removeNeighbor = (i: number, ni: number) => {
    if (i >= questions.length) return;
    setNeighbors(i, questions[i]!.neighbors.filter((_, idx) => idx !== ni));
  };

  const moveNeighbor = (i: number, ni: number, dir: -1 | 1) => {
    if (i >= questions.length) return;
    const neighbors = [...questions[i]!.neighbors];
    const target = ni + dir;
    if (target < 0 || target >= neighbors.length) return;
    [neighbors[ni], neighbors[target]] = [neighbors[target]!, neighbors[ni]!];
    setNeighbors(i, neighbors);
  };

  /** Replaces the neighbor list with a generated one. `bump` re-rolls the seed. */
  const autoFill = (i: number, bump: boolean) => {
    const base = i >= questions.length ? empty() : questions[i]!;
    if (!cities || !base.center.name.trim()) return;
    const seed = bump ? (seeds[i] ?? 1) + 1 : (seeds[i] ?? 1);
    setSeeds(prev => ({ ...prev, [i]: seed }));
    setNeighbors(i, pickNeighbors(base.center, cities, { count: autoCount, seed, difficulty }));
  };

  const distancesOn = showDistances === true;

  return (
    <div>
      <div className="city-compass-settings">
        <label className="be-toggle">
          <input
            type="checkbox"
            checked={distancesOn}
            onChange={e => onChangeShowDistances(e.target.checked || undefined)}
          />
          <span className="be-toggle-track" />
          <span className="be-toggle-label">Entfernungen anzeigen</span>
        </label>
        <label className="be-toggle be-scoring-mode">
          <span className="be-toggle-label">Aufdecken</span>
          <select
            className="be-select"
            aria-label="Aufdecken"
            value={reveal ?? 'all'}
            onChange={e => onChangeReveal(e.target.value === 'all' ? undefined : 'progressive')}
          >
            <option value="all" title="Die ganze Konstellation ist sofort sichtbar.">Alle auf einmal</option>
            <option value="progressive" title="Zwei Städte zu Beginn, mit jedem Weiter eine mehr.">Schrittweise</option>
          </select>
        </label>
      </div>

      {displayQuestions.map((q, i) => {
        const isVirtual = i >= questions.length;
        const hasCenter = Boolean(q.center?.name?.trim());
        const neighbors = q.neighbors ?? [];
        return (
          <div
            key={i}
            className={`question-block ${!isVirtual && drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''} ${isVirtual ? 'question-block--ghost' : ''}`}
            data-question-index={i}
            onDragOver={isVirtual ? undefined : drag.onDragOver(i)}
            onDragEnd={isVirtual ? undefined : drag.onDragEnd}
          >
            <div className="question-block-row">
              <span className="drag-handle" draggable={!isVirtual} onDragStart={isVirtual ? undefined : drag.onDragStart(i)} style={isVirtual ? { visibility: 'hidden' } : undefined}>⠿</span>
              <span className="question-num">{isVirtual ? 'Neu' : i === 0 ? 'Beispiel' : `#${i}`}</span>
              <div style={{ flex: 1 }} />
              {!isVirtual && <>
                <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(var(--glass-rgb), 0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
                <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.06)', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
                {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
                <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
              </>}
            </div>

            <div className="question-fields">
              <div className="full-width">
                <label className="be-label">Gesuchte Stadt (Zentrum)</label>
                {hasCenter && (
                  <div className="city-chip city-chip--center">
                    <span className="city-chip__name">{q.center.name}</span>
                    {q.center.country && <span className="city-chip__meta">{q.center.country}</span>}
                    <span className="city-chip__meta">
                      {q.center.lat.toFixed(3)}, {q.center.lon.toFixed(3)}
                    </span>
                  </div>
                )}
                <CitySearch
                  placeholder={isVirtual ? 'Neue Frage – Stadt suchen…' : 'Stadt suchen, z.B. Wien'}
                  taken={neighbors.map(c => c.name)}
                  onPick={city => update(i, { center: toCompassCity(city) })}
                />
              </div>

              {!isVirtual && (
                <div className="full-width">
                  <div className="city-compass-toolbar">
                    <label className="be-label" style={{ margin: 0 }}>Nachbarstädte ({neighbors.length})</label>
                    <div style={{ flex: 1 }} />
                    <select className="be-select city-compass-toolbar__select" value={autoCount} onChange={e => setAutoCount(Number(e.target.value))} title="Anzahl der Städte">
                      {Array.from({ length: MAX_NEIGHBOR_COUNT - MIN_NEIGHBOR_COUNT + 1 }, (_, n) => MIN_NEIGHBOR_COUNT + n).map(n => (
                        <option key={n} value={n}>{n} Städte</option>
                      ))}
                    </select>
                    <select className="be-select city-compass-toolbar__select" value={difficulty} onChange={e => setDifficulty(e.target.value as CompassDifficulty)} title="Schwierigkeit">
                      {(Object.keys(DIFFICULTY_LABELS) as CompassDifficulty[]).map(key => (
                        <option key={key} value={key}>{DIFFICULTY_LABELS[key]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="be-btn-primary"
                      disabled={!hasCenter || !cities}
                      title={hasCenter ? 'Passende Städte automatisch auswählen' : 'Zuerst die gesuchte Stadt wählen'}
                      onClick={() => autoFill(i, false)}
                    >
                      Auto
                    </button>
                    <button
                      type="button"
                      className="be-icon-btn"
                      disabled={!hasCenter || !cities}
                      title="Andere Städte auswählen"
                      onClick={() => autoFill(i, true)}
                    >
                      Neu würfeln
                    </button>
                  </div>

                  {neighbors.length === 0 && (
                    <div className="city-compass-hint">
                      Noch keine Städte. „Auto" wählt passende aus – bekannte Städte in der Ferne,
                      auch kleinere in der Nähe. Die Reihenfolge ist die Aufdeck-Reihenfolge.
                    </div>
                  )}

                  {neighbors.map((city, ni) => {
                    const distance = haversineKm(q.center, city);
                    const bearing = initialBearingDeg(q.center, city);
                    const tooFar = distance > MAX_NEIGHBOR_DISTANCE_KM;
                    return (
                      <div key={`${city.name}-${ni}`} className="city-chip">
                        <span className="city-chip__rank">{ni + 1}</span>
                        <span className="city-chip__name">{city.name}</span>
                        {city.country && <span className="city-chip__meta">{city.country}</span>}
                        <span className={`city-chip__meta${tooFar ? ' city-chip__meta--warn' : ''}`}>
                          {formatDistanceKm(distance)} · {Math.round(bearing)}°
                          {tooFar && ' · über 2000 km'}
                        </span>
                        <div style={{ flex: 1 }} />
                        <button type="button" className="be-icon-btn" title="Nach oben" disabled={ni === 0} onClick={() => moveNeighbor(i, ni, -1)}>↑</button>
                        <button type="button" className="be-icon-btn" title="Nach unten" disabled={ni === neighbors.length - 1} onClick={() => moveNeighbor(i, ni, 1)}>↓</button>
                        <button type="button" className="be-icon-btn danger" title="Entfernen" onClick={() => removeNeighbor(i, ni)}>×</button>
                      </div>
                    );
                  })}

                  <CitySearch
                    placeholder="Stadt hinzufügen…"
                    taken={[q.center.name, ...neighbors.map(c => c.name)].filter(Boolean)}
                    onPick={city => addNeighbor(i, city)}
                  />
                </div>
              )}

              {!isVirtual && hasCenter && neighbors.length > 0 && (
                <div className="full-width">
                  <label className="be-label">Vorschau</label>
                  <CompassRose
                    center={q.center}
                    neighbors={neighbors}
                    showDistances={distancesOn}
                    className="compass-rose--fit"
                  />
                </div>
              )}

              {!isVirtual && (
                <>
                  <div className="full-width">
                    <label className="be-label">Fragetext (optional)</label>
                    <SpellField segKey={`q${i}.question`} className="be-input" value={q.question ?? ''} placeholder="Welche Stadt liegt im Zentrum?" onChange={e => update(i, { question: e.target.value || undefined })} />
                  </div>
                  <div className="full-width">
                    <label className="be-label">Zusatzinfo (optional, über der Frage)</label>
                    <SpellField segKey={`q${i}.info`} className="be-input" value={q.info ?? ''} placeholder="Darf die Lösung nicht verraten" onChange={e => update(i, { info: e.target.value || undefined })} />
                  </div>
                  <div>
                    <AssetField
                      label="Bild zur Auflösung (optional)"
                      value={q.answerImage || undefined}
                      category="images"
                      onChange={v => update(i, { answerImage: v || undefined })}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
