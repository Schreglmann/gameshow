import { useState, useEffect, useRef, useCallback, startTransition } from 'react';
import type { BandleQuestion, BandleCatalogEntry } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { fetchBandleCatalog } from '@/services/backendApi';

interface Props {
  questions: BandleQuestion[];
  onChange: (questions: BandleQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

// ── Instrument label translation ──

const labelMap: Record<string, string> = {
  drum: 'Schlagzeug', bass: 'Bass', guitar: 'Gitarre', electric: 'E-Gitarre',
  synth: 'Synthesizer', voice: 'Gesang', harmony: 'Harmonien', brass: 'Bläser',
  piano: 'Klavier', strings: 'Streicher', organ: 'Orgel', choir: 'Chor',
  sax: 'Saxophon', mandolin: 'Mandoline', harp: 'Harfe', effect: 'Effekte',
  clue: 'Hinweis',
};

function germanizeLabel(label: string): string {
  return label.replace(/\[?([a-z]+)\]?/g, (_m, word) => labelMap[word] || word);
}

function songSlug(name: string): string {
  return name
    .replace(/\s*\(feat\..*?\)/gi, '')
    .replace(/\s*ft\..*$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function catalogToQuestion(entry: BandleCatalogEntry): BandleQuestion {
  const instruments = entry.instruments.filter(i => i !== 'clue');
  const slug = songSlug(entry.song);
  return {
    answer: entry.song,
    tracks: instruments.map((inst, i) => ({
      label: germanizeLabel(inst),
      audio: `/audio/bandle/${slug}/track${i + 1}.mp3`,
    })),
    ...(entry.clue ? { hint: entry.clue } : {}),
    releaseYear: entry.year,
    clicks: entry.view,
    difficulty: entry.par,
  };
}

// ── Helpers ──

function parLabel(par: number): string {
  if (par <= 1) return 'Sehr leicht';
  if (par <= 2) return 'Leicht';
  if (par <= 3) return 'Mittel';
  if (par <= 4) return 'Schwer';
  return 'Sehr schwer';
}

function viewLabel(view: number): string {
  if (view >= 1000) return `${(view / 1000).toFixed(1)}B`;
  return `${view}M`;
}

// ── SVG Icons (matching AudioGuessForm pattern) ──

const IconBurger = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>;
const IconEye = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
const IconEyeOff = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;
const IconDuplicate = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
const IconTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>;
const IconPlay = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>;
const IconStop = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>;

const btnStyle = { width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' } as const;
const btnDanger = { ...btnStyle, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' } as const;

// ── Inline Audio Player ──

// Only one track plays at a time across all TrackPlayer instances
let _activeAudio: HTMLAudioElement | null = null;
let _activeStop: (() => void) | null = null;

function TrackPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      _activeAudio = null;
      _activeStop = null;
    } else {
      // Stop any other playing track first
      if (_activeStop) _activeStop();
      audio.currentTime = 0;
      audio.play().then(() => {
        setPlaying(true);
        _activeAudio = audio;
        _activeStop = () => { audio.pause(); setPlaying(false); _activeAudio = null; _activeStop = null; };
      }).catch(() => setBroken(true));
    }
  }, [playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => setPlaying(false);
    const onError = () => { setPlaying(false); setBroken(true); };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => { audio.removeEventListener('ended', onEnded); audio.removeEventListener('error', onError); audio.pause(); };
  }, []);

  if (broken) return <span style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, opacity: 0.3, flexShrink: 0 }} title="Audio nicht verfügbar">—</span>;

  return (
    <>
      <audio ref={audioRef} src={src} preload="none" />
      <button type="button" className="be-delete-btn" onClick={toggle} title={playing ? 'Stopp' : 'Abspielen'} style={{ ...btnStyle, width: 26, height: 26 }}>
        {playing ? <IconStop /> : <IconPlay />}
      </button>
    </>
  );
}

// ── Multi-select toggle chips ──

function ToggleChips({ options, selected, onToggle, label }: {
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  label: string;
}) {
  return (
    <div className="bandle-chip-group">
      <span className="bandle-chip-label">{label}</span>
      {options.map(o => (
        <button
          type="button"
          key={o.value}
          className={`bandle-chip${selected.has(o.value) ? ' active' : ''}`}
          onClick={() => onToggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Song Picker Modal ──

interface PickerProps {
  catalog: BandleCatalogEntry[];
  existingPaths: Set<string>;
  onSelect: (entry: BandleCatalogEntry) => void;
  onClose: () => void;
}

function BandleSongPicker({ catalog, existingPaths, onSelect, onClose }: PickerProps) {
  const [search, setSearch] = useState('');
  const [selectedPars, setSelectedPars] = useState<Set<string>>(new Set());
  const [selectedPack, setSelectedPack] = useState('');
  const [selectedDecades, setSelectedDecades] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(50);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) startTransition(() => setVisibleCount(prev => prev + 50)); },
      { root: listRef.current, rootMargin: '0px 0px 2000px 0px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setVisibleCount(50); }, [search, selectedPars, selectedPack, selectedDecades]);

  const toggleSet = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  const allPacks = [...new Set(catalog.flatMap(s => s.packs))].filter(p => p !== 'Gratis').sort();

  const filtered = catalog.filter(s => {
    if (existingPaths.has(s.path)) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${s.song} ${s.frontperson || ''} ${(s.sources || []).join(' ')}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (selectedPars.size > 0 && !selectedPars.has(String(s.par))) return false;
    if (selectedPack && !s.packs.includes(selectedPack)) return false;
    if (selectedDecades.size > 0) {
      const decade = String(Math.floor(s.year / 10) * 10);
      if (!selectedDecades.has(decade)) return false;
    }
    return true;
  }).sort((a, b) => b.view - a.view);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker-modal bandle-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>Song hinzufügen</h3>
          <span className="bandle-picker-count">{filtered.length} Songs</span>
          <button type="button" className="be-delete-btn" onClick={onClose} style={btnStyle}>✕</button>
        </div>

        <div className="bandle-picker-filters">
          <input
            ref={inputRef}
            className="be-input bandle-picker-search"
            type="text"
            placeholder="Song, Künstler oder Band suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <ToggleChips
            label="Schwierigkeit"
            options={[1, 2, 3, 4, 5].map(p => ({ value: String(p), label: `${parLabel(p)} (${p})` }))}
            selected={selectedPars}
            onToggle={v => setSelectedPars(prev => toggleSet(prev, v))}
          />

          <ToggleChips
            label="Jahrzehnt"
            options={[2020, 2010, 2000, 1990, 1980, 1970, 1960].map(d => ({ value: String(d), label: `${d}er` }))}
            selected={selectedDecades}
            onToggle={v => setSelectedDecades(prev => toggleSet(prev, v))}
          />

          <div className="bandle-chip-group">
            <span className="bandle-chip-label">Pack</span>
            <select className="be-select bandle-pack-select" value={selectedPack} onChange={e => setSelectedPack(e.target.value)}>
              <option value="">Alle Packs</option>
              {allPacks.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="bandle-picker-list" ref={listRef}>
          {filtered.slice(0, visibleCount).map(entry => (
            <div key={entry.path} className="bandle-picker-item" onClick={() => onSelect(entry)}>
              <div className="bandle-picker-item-body">
                <div className="bandle-picker-item-main">
                  <span className="bandle-picker-item-title">{entry.song}</span>
                  <span className="bandle-picker-item-year">{entry.year}</span>
                </div>
                <div className="bandle-picker-item-meta">
                  <span className="bandle-picker-badge" title="Schwierigkeit">Par {entry.par} – {parLabel(entry.par)}</span>
                  <span className="bandle-picker-badge" title="YouTube Views">{viewLabel(entry.view)}</span>
                  {entry.packs.filter(p => p !== 'Gratis').slice(0, 2).map(p => (
                    <span key={p} className="bandle-picker-badge bandle-badge-pack">{p}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <div ref={sentinelRef} style={{ height: 1 }} />
          {filtered.length === 0 && (
            <div className="bandle-picker-empty">Keine Songs gefunden</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Form ──

export default function BandleForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const drag = useDragReorder(questions, onChange);
  const [catalog, setCatalog] = useState<BandleCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Click outside any question-block to close expanded
  useEffect(() => {
    if (expandedIdx === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.question-block')) {
        setExpandedIdx(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [expandedIdx]);

  const openPicker = useCallback(async () => {
    if (catalog.length === 0 && !catalogLoading) {
      setCatalogLoading(true);
      try { setCatalog(await fetchBandleCatalog()); }
      catch (e) { console.error('Failed to load bandle catalog:', e); }
      setCatalogLoading(false);
    }
    setPickerOpen(true);
  }, [catalog.length, catalogLoading]);

  const existingPaths = new Set(
    questions.map(q => {
      const m = q.tracks[0]?.audio?.match(/\/audio\/bandle\/([^/]+)\//);
      return m ? m[1] : '';
    }).filter(Boolean)
  );

  const addFromCatalog = (entry: BandleCatalogEntry) => {
    onChange([...questions, catalogToQuestion(entry)]);
    setPickerOpen(false);
  };

  const update = (i: number, patch: Partial<BandleQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const remove = (i: number) => onChange(questions.filter((_, idx) => idx !== i));

  const duplicate = (i: number) => {
    const next = [...questions];
    next.splice(i + 1, 0, JSON.parse(JSON.stringify(questions[i])));
    onChange(next);
  };

  const toggleExpand = (i: number) => {
    setExpandedIdx(prev => prev === i ? null : i);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="be-label" style={{ margin: 0 }}>Fragen ({questions.length})</span>
      </div>

      {questions.map((q, i) => {
        const isOpen = expandedIdx === i;
        const lastTrack = q.tracks[q.tracks.length - 1];
        const isExample = i === 0;

        return (
          <div
            key={i}
            className={`question-block${drag.overIdx === i ? ' be-dragging' : ''}${q.disabled ? ' question-disabled' : ''}`}
            data-question-index={i}
            onDragOver={drag.onDragOver(i)}
            onDragEnd={drag.onDragEnd}
          >
            <div className="question-block-row">
              <span className="drag-handle" draggable onDragStart={drag.onDragStart(i)} title="Ziehen zum Sortieren">⠿</span>
              <span className="question-num">{isExample ? '★' : `#${i}`}</span>

              {lastTrack && <TrackPlayer src={lastTrack.audio}  />}

              <div className="question-block-inputs" onClick={() => toggleExpand(i)} style={{ cursor: 'pointer' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{q.answer || '(kein Song)'}</span>
                <span style={{ fontSize: 11, opacity: 0.5 }}>
                  {q.tracks.length} Tracks{isExample ? ' · Beispiel' : ''}
                </span>
              </div>

              {q.answerImage && (
                <img src={q.answerImage} alt="" style={{ height: 28, width: 28, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', flexShrink: 0 }} />
              )}

              {q.difficulty != null && (
                <span style={{ fontSize: 18, letterSpacing: 1, flexShrink: 0, cursor: 'default' }} title={`Schwierigkeit: Par ${q.difficulty} – ${parLabel(q.difficulty)}`}>
                  {'★'.repeat(q.difficulty)}{'☆'.repeat(5 - q.difficulty)}
                </span>
              )}

              <button type="button" className="be-delete-btn" onClick={() => toggleExpand(i)} title={isOpen ? 'Zuklappen' : 'Aufklappen'} style={btnStyle}>
                <IconBurger />
              </button>
              <button type="button" className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ ...btnStyle, ...(q.disabled ? { border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.12)', color: 'rgba(239,68,68,0.7)' } : {}) }}>
                {q.disabled ? <IconEyeOff /> : <IconEye />}
              </button>
              <button type="button" className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={btnStyle}><IconDuplicate /></button>
              {otherInstances && otherInstances.length > 0 && onMoveQuestion && (
                <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />
              )}
              <button type="button" className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={btnDanger}><IconTrash /></button>
            </div>

            {isOpen && (
              <div style={{ padding: '8px 0 4px 30px' }}>
                <div className="question-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <span className="be-label">Tracks</span>
                    {q.tracks.map((track, tIdx) => (
                      <div key={tIdx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                        <TrackPlayer src={track.audio}  />
                        <span style={{ fontSize: 12, opacity: 0.7, minWidth: 50 }}>Stufe {tIdx + 1}</span>
                        <span style={{ fontSize: 13 }}>{track.label}</span>
                      </div>
                    ))}
                    {q.hint && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                        <label className="be-toggle" style={{ margin: 0, flexShrink: 0, width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          <input
                            type="checkbox"
                            checked={!!q.hintEnabled}
                            onChange={() => update(i, { hintEnabled: !q.hintEnabled || undefined })}
                          />
                          <span className="be-toggle-track" />
                        </label>
                        <span style={{ fontSize: 12, opacity: 0.7, minWidth: 50 }}>Stufe {q.tracks.length + 1}</span>
                        <span style={{ fontSize: 13, opacity: q.hintEnabled ? 1 : 0.4 }}><span style={{ opacity: 0.45 }}>Hinweis:</span> {q.hint}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignSelf: 'stretch' }}>
                    {(q.releaseYear || q.clicks || q.difficulty != null) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 25 }}>
                        {q.releaseYear && <span style={{ fontSize: 14 }}><span style={{ opacity: 0.45 }}>Erschienen:</span> <strong>{q.releaseYear}</strong></span>}
                        {q.clicks && <span style={{ fontSize: 14 }}><span style={{ opacity: 0.45 }}>Klicks:</span> <strong>{viewLabel(q.clicks)}</strong></span>}
                        {q.difficulty != null && <span style={{ fontSize: 14 }}><span style={{ opacity: 0.45 }}>Schwierigkeit:</span> <strong>Par {q.difficulty} – {parLabel(q.difficulty)}</strong></span>}
                      </div>
                    )}
                    <AssetField
                      label="Cover-Bild (optional)"
                      value={q.answerImage}
                      category="images"
                      onChange={v => update(i, { answerImage: v })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="be-btn-primary" onClick={openPicker} style={{ marginTop: 8 }}>
        {catalogLoading ? 'Katalog wird geladen...' : '+ Song aus Katalog hinzufügen'}
      </button>

      {pickerOpen && (
        <BandleSongPicker
          catalog={catalog}
          existingPaths={existingPaths}
          onSelect={addFromCatalog}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
