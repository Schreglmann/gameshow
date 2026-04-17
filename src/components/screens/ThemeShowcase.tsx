import { useState, useEffect } from 'react';
import { useTheme, THEMES } from '@/context/ThemeContext';
import type { ThemeId } from '@/context/ThemeContext';
import { Link } from 'react-router-dom';
import { JobRow, type UnifiedJob } from '@/components/backend/SystemTab';
import '@/admin.css';
import '@/backend.css';
import '@/styles/gamemaster.css';

const THEME_GRADIENTS: Record<string, [string, string]> = {
  galaxia: ['#4a5bc4', '#5a3585'],
  'harry-potter': ['#1c0b2e', '#2a0e3a'],
  dnd: ['#111111', '#1a2416'],
  arctic: ['#0f2027', '#203a43'],
  enterprise: ['#0f172a', '#1e293b'],
  retro: ['#000000', '#1a1a2e'],
};

function ThemeRow({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {THEMES.map(t => {
        const [from, to] = THEME_GRADIENTS[t.id];
        const active = value === t.id;
        return (
          <button
            key={t.id}
            className="theme-option"
            style={active ? { borderColor: 'var(--admin-accent)', background: 'rgba(var(--admin-accent-rgb), 0.1)' } : undefined}
            onClick={() => onChange(t.id)}
          >
            <div className="theme-preview" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }} />
            <span className="theme-name">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ textAlign: 'left', marginBottom: 12, fontSize: '0.95em', borderBottom: '1px solid rgba(var(--glass-rgb), 0.15)', paddingBottom: 6, color: 'rgba(var(--text-rgb), 0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h3>
      {children}
    </div>
  );
}

function GlassCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="quiz-container" style={{ animation: 'none', width: '100%', minHeight: 'auto', margin: 0, ...style }}>
      {children}
    </div>
  );
}

const PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250">' +
  '<rect fill="#334155" width="400" height="250" rx="4"/>' +
  '<text x="200" y="118" text-anchor="middle" fill="#94a3b8" font-family="system-ui" font-size="16">Bild-Platzhalter</text>' +
  '<path d="M170 140 l20-30 l15 20 l10-10 l25 35 h-70z" fill="#475569"/>' +
  '<circle cx="185" cy="100" r="10" fill="#475569"/>' +
  '</svg>'
);

function FrontendShowcase() {
  return (
    <div>
      <Section title="Header">
        <header style={{ position: 'relative', animation: 'none' }}>
          <div>Team 1: <span>12</span> Punkte</div>
          <div>Spiel 3 von 8</div>
          <div>Team 2: <span>9</span> Punkte</div>
        </header>
      </Section>

      <Section title="Typography">
        <h1 style={{ marginTop: 0 }}>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3 style={{ marginBottom: 8 }}>Heading 3</h3>
        <GlassCard>
          <p style={{ color: 'var(--text-primary)', marginBottom: 4 }}>Primary text on glass card</p>
          <p style={{ color: 'rgba(var(--text-rgb), 0.7)', marginBottom: 4 }}>Secondary text (70%)</p>
          <p style={{ color: 'rgba(var(--text-rgb), 0.5)', marginBottom: 4 }}>Muted text (50%)</p>
          <p style={{ color: 'rgba(var(--text-rgb), 0.35)' }}>Faint text (35%)</p>
        </GlassCard>
      </Section>

      <Section title="Buttons">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
          <button>Accent Button</button>
          <button className="quiz-button active">Active / Success</button>
          <button className="next-game-button" style={{ margin: 0, display: 'inline-block' }}>Weiter</button>
          <button className="music-control-button" style={{ margin: 0 }}>Ausschnitt wiederholen</button>
          <button disabled>Disabled</button>
        </div>
      </Section>

      <Section title="Quiz — Question & Answer">
        <GlassCard>
          <div className="quiz-question-number">Frage 3 von 10</div>
          <div className="quiz-question" style={{ marginBottom: 16 }}>Wie heisst die Hauptstadt von Frankreich?</div>
          <img className="quiz-image" src={PLACEHOLDER_IMG} alt="Platzhalter" style={{ maxHeight: 140 }} />
          <div className="quiz-answer" style={{ animation: 'none' }}>
            <p>Paris</p>
          </div>
        </GlassCard>
      </Section>

      <Section title="Audio Controls">
        <GlassCard>
          <div className="quiz-question">Welcher Song ist das?</div>
          <div className="audio-controls">
            <button className="audio-ctrl-btn">&#9654;</button>
            <div className="audio-ctrl-divider" />
            <button className="audio-ctrl-btn">&#8634;</button>
            <div className="audio-ctrl-divider" />
            <span className="audio-timestamp">0:12 / 0:30</span>
          </div>
          <div className="button-row">
            <button className="music-control-button" style={{ margin: 0 }}>Ausschnitt wiederholen</button>
            <button className="music-control-button" style={{ margin: 0 }}>Ganzer Song</button>
          </div>
        </GlassCard>
      </Section>

      <Section title="Answer List">
        <GlassCard>
          <div className="quiz-question" style={{ marginBottom: 12 }}>Welches Land hat die meisten Einwohner?</div>
          <ul className="answer-list" style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}>
            <li>A) USA</li>
            <li className="correct">B) China</li>
            <li>C) Indien</li>
            <li>D) Russland</li>
          </ul>
        </GlassCard>
      </Section>

      <Section title="Answer with Image">
        <GlassCard style={{ textAlign: 'left' }}>
          <div className="answer-list-with-image">
            <img className="quiz-image" src={PLACEHOLDER_IMG} alt="Platzhalter" style={{ maxHeight: 120, margin: 0 }} />
            <ul className="answer-list">
              <li>A) Berlin</li>
              <li className="correct">B) Wien</li>
              <li>C) Bern</li>
            </ul>
          </div>
        </GlassCard>
      </Section>

      <Section title="Timer">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          <div className="timer-display">0:45</div>
          <div className="timer-display timer-display--low">0:08</div>
          <div className="timer-display timer-display--done" style={{ animation: 'none' }}>0:00</div>
        </div>
      </Section>

      <Section title="Gamemaster Correct-Answers Tracker">
        <div className="gm-correct-panel">
          <div className="gm-correct-team">
            <div className="gm-correct-label">Team 1</div>
            <div className="gm-correct-members">Anna, Ben, Carla</div>
            <div className="gm-correct-row">
              <button className="gm-btn gm-correct-btn">−</button>
              <div className="gm-correct-count">5</div>
              <button className="gm-btn gm-correct-btn">+</button>
            </div>
          </div>
          <div className="gm-correct-team">
            <div className="gm-correct-label">Team 2</div>
            <div className="gm-correct-members">Dora, Eric, Finn</div>
            <div className="gm-correct-row">
              <button className="gm-btn gm-correct-btn" disabled>−</button>
              <div className="gm-correct-count">0</div>
              <button className="gm-btn gm-correct-btn">+</button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Award Points">
        <GlassCard>
          <h2 style={{ fontSize: '1.6em', marginBottom: 4 }}>Punkte vergeben</h2>
          <p className="award-points-hint">Wer hat diese Runde gewonnen?</p>
          <div className="button-row" style={{ marginBottom: 8 }}>
            <button className="award-team-button">Team 1</button>
            <button className="award-team-button active">Team 2</button>
          </div>
          <p className="award-points-warning">3 Punkte werden vergeben</p>
        </GlassCard>
      </Section>

      <Section title="Guessing Game Results">
        <GlassCard style={{ textAlign: 'left' }}>
          <div className="result-row" style={{ margin: '8px 0' }}>
            <span>Team 1: <strong>42</strong></span>
            <span className="difference">Differenz: 3</span>
          </div>
          <div className="result-row" style={{ margin: '8px 0' }}>
            <span>Team 2: <strong>50</strong></span>
            <span className="difference">Differenz: 11</span>
          </div>
          <div className="winner" style={{ animation: 'none', marginTop: 16, fontSize: '1.2em', padding: 16 }}>
            Team 1 ist naeher dran!
          </div>
        </GlassCard>
      </Section>

      <Section title="Bandle Tracks">
        <div className="bandle-tracks" style={{ margin: 0 }}>
          <div className="bandle-track hidden">
            <div className="bandle-track-number">Stufe 1</div>
            <div className="bandle-track-label">???</div>
          </div>
          <div className="bandle-track revealed">
            <div className="bandle-track-number">Stufe 2</div>
            <div className="bandle-track-label">Gitarre</div>
          </div>
          <div className="bandle-track revealed active" style={{ animation: 'none' }}>
            <div className="bandle-track-number">Stufe 3</div>
            <div className="bandle-track-label">Gesang</div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="bandle-tracks" style={{ margin: 0, maxWidth: 300 }}>
            <div className="bandle-track bandle-track-answer hidden" style={{ minHeight: 'auto', padding: 12 }}>Antwort aufdecken</div>
            <div className="bandle-track bandle-track-answer revealed" style={{ minHeight: 'auto', padding: 12 }}>Bohemian Rhapsody</div>
          </div>
        </div>
        <div className="bandle-meta" style={{ marginTop: 12 }}>
          <span className="bandle-meta-item"><span className="bandle-meta-label">Kuenstler: </span>Queen</span>
          <span className="bandle-meta-item"><span className="bandle-meta-label">Jahr: </span>1975</span>
        </div>
        <div className="bandle-player" style={{ marginTop: 12 }}>
          <div className="bandle-progress" style={{ padding: 0, height: 6 }}>
            <div className="bandle-progress-fill" style={{ width: '45%' }} />
          </div>
        </div>
      </Section>

      <Section title="Statements">
        <div style={{ maxWidth: 500, margin: '0 auto' }}>
          <div className="statement">Ich war schon einmal in Japan</div>
          <div className="statement" style={{ background: 'rgba(var(--glass-rgb), 0.2)' }}>Ich kann Klavier spielen (hover)</div>
        </div>
      </Section>

      <Section title="Quizjagd Labels">
        <GlassCard>
          <p className="quizjagd-team-label">Team 1 ist dran</p>
          <p className="quizjagd-difficulty">Schwierigkeit: Mittel</p>
        </GlassCard>
      </Section>

      <Section title="Color Swatches">
        <div className="color-swatches">
          <div className="color-swatch" style={{ background: '#e63946' }} />
          <div className="color-swatch" style={{ background: '#457b9d' }} />
          <div className="color-swatch" style={{ background: '#2a9d8f' }} />
          <div className="color-swatch" style={{ background: '#e9c46a' }} />
        </div>
      </Section>

      <Section title="Image Guess">
        <GlassCard>
          <div className="image-guess-step">Aufloesung: 25%</div>
          <div className="image-guess-container" style={{ maxWidth: 300, margin: '0 auto' }}>
            <img className="image-guess-image" src={PLACEHOLDER_IMG} alt="Platzhalter" style={{ imageRendering: 'pixelated', filter: 'blur(6px)' }} />
          </div>
        </GlassCard>
      </Section>

      <Section title="Form / Name Entry">
        <div className="name-form" style={{ marginBottom: 0 }}>
          <h2 style={{ fontSize: '1.4em' }}>Team-Namen</h2>
          <textarea placeholder="Name 1, Name 2, ..." style={{ height: 80, margin: 0 }} readOnly />
          <button>Teams zuweisen</button>
        </div>
      </Section>

      <Section title="Team Cards">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div className="team" style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ fontSize: '1.2em' }}>Team 1</h2>
            <p style={{ color: 'rgba(var(--text-rgb), 0.7)' }}>Anna, Ben, Clara</p>
            <p style={{ fontSize: '1.5em', fontWeight: 700, marginTop: 8 }}>12 Punkte</p>
          </div>
          <div className="team" style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ fontSize: '1.2em' }}>Team 2</h2>
            <p style={{ color: 'rgba(var(--text-rgb), 0.7)' }}>David, Eva, Finn</p>
            <p style={{ fontSize: '1.5em', fontWeight: 700, marginTop: 8 }}>9 Punkte</p>
          </div>
        </div>
      </Section>

      <Section title="Rules Container">
        <div className="rules-container" style={{ width: '100%', margin: 0, animation: 'none' }}>
          <h1 style={{ fontSize: '1.4em', textShadow: 'none', marginTop: 0 }}>Spielregeln</h1>
          <ul style={{ textAlign: 'left', listStyleType: 'disc', paddingLeft: 24, marginBottom: 0 }}>
            <li style={{ color: 'white', padding: '6px 0', border: 'none' }}>Jedes Team beantwortet abwechselnd</li>
            <li style={{ color: 'white', padding: '6px 0', border: 'none' }}>Pro richtige Antwort gibt es Punkte</li>
          </ul>
        </div>
      </Section>

      <Section title="Loading Spinner">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="video-loading-spinner" />
        </div>
      </Section>
    </div>
  );
}

function JobRowShowcase() {
  const now = Date.now();
  const jobs: UnifiedJob[] = [
    {
      key: 'demo-yt',
      source: 'yt',
      dl: { id: 'yt-1', title: 'Bohemian Rhapsody (Official Video)', phase: 'downloading', percent: 47, playlistTotal: 12, playlistDone: 3, elapsed: 42 },
    },
    {
      key: 'demo-yt-resolving',
      source: 'yt',
      dl: { id: 'yt-2', title: 'Playlist: Top 100 Songs', phase: 'resolving', percent: 0, elapsed: 3 },
    },
    {
      key: 'demo-video-running',
      source: 'bgTask',
      task: {
        id: 'demo-1', type: 'compressed-warmup', status: 'running',
        label: 'Compressed-Warmup: the-matrix-1999.mp4',
        detail: '68 %', elapsed: 42, queuedAt: now - 120_000, runningAt: now - 42_000,
        meta: { video: 'films/the-matrix-1999.mp4', start: 900, end: 940, kind: 'compressed' },
      },
    },
    {
      key: 'demo-whisper',
      source: 'whisper',
      job: { video: 'interviews/elon-musk.mp4', language: 'en', status: 'running', phase: 'transcribing', percent: 23, elapsed: 180 },
    },
    {
      key: 'demo-nas',
      source: 'bgTask',
      task: { id: 'demo-2', type: 'nas-sync', status: 'running', label: 'NAS Sync: upload images/poster.png', elapsed: 3, queuedAt: now - 3_000, runningAt: now - 3_000 },
    },
    {
      key: 'demo-video-queued-1',
      source: 'bgTask',
      task: {
        id: 'demo-3', type: 'sdr-warmup', status: 'queued',
        label: 'SDR-Warmup: dune-2021.m4v',
        detail: '120s–160s', elapsed: 0, queuedAt: now - 5_000,
        meta: { video: 'films/dune-2021.m4v', start: 120, end: 160, kind: 'sdr' },
      },
    },
    {
      key: 'demo-video-queued-2',
      source: 'bgTask',
      task: {
        id: 'demo-4', type: 'compressed-warmup', status: 'queued',
        label: 'Compressed-Warmup: interstellar.mp4',
        detail: '45s–80s', elapsed: 0, queuedAt: now - 3_000,
        meta: { video: 'films/interstellar.mp4', start: 45, end: 80, kind: 'compressed' },
      },
    },
    {
      key: 'demo-whisper-pending',
      source: 'whisper',
      job: { video: 'podcasts/episode-42.mp4', language: 'de', status: 'pending', percent: 0, elapsed: 0 },
    },
    {
      key: 'demo-poster',
      source: 'bgTask',
      task: { id: 'demo-5', type: 'poster-fetch', status: 'done', label: 'Poster: inception.jpg', elapsed: 2, queuedAt: now - 2_000, runningAt: now - 2_000 },
    },
    {
      key: 'demo-error',
      source: 'bgTask',
      task: { id: 'demo-6', type: 'faststart', status: 'error', label: 'Faststart-Remux: clip.mp4', detail: 'ffmpeg exit 1: codec unsupported', elapsed: 8, queuedAt: now - 8_000, runningAt: now - 8_000 },
    },
  ];
  return <>{jobs.map(j => <JobRow key={j.key} job={j} />)}</>;
}

function AdminShowcase() {
  return (
    <div>
      <Section title="Page Title">
        <h2 className="tab-title">Konfiguration</h2>
        <span className="section-title">Gameshows</span>
      </Section>

      <Section title="Cards & Forms">
        <div className="backend-card">
          <h3>Globale Einstellungen</h3>
          <label className="be-label">Spielname</label>
          <input className="be-input" defaultValue="Allgemeinwissen" readOnly />
          <label className="be-label">Beschreibung</label>
          <textarea className="be-textarea" defaultValue="Ein kurzes Quiz..." readOnly style={{ minHeight: 50 }} />
          <label className="be-label">Spieltyp</label>
          <select className="be-select" defaultValue="simple-quiz">
            <option>simple-quiz</option>
            <option>guessing-game</option>
          </select>
          <label className="be-checkbox-row" style={{ marginTop: 10 }}>
            <input type="checkbox" defaultChecked readOnly />
            Punktesystem aktiviert
          </label>
          <label className="be-checkbox-row">
            <input type="checkbox" readOnly />
            Team-Randomisierung aktiviert
          </label>
          <label className="be-hint">games/allgemeinwissen.json</label>
        </div>
      </Section>

      <Section title="Toggle">
        <label className="be-toggle">
          <input type="checkbox" defaultChecked readOnly />
          <span className="be-toggle-track" />
          <span className="be-toggle-label">Instanz-Modus</span>
        </label>
      </Section>

      <Section title="Buttons">
        <div className="backend-card">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="be-icon-btn">+ Hinzufügen</button>
            <button className="be-icon-btn danger">Löschen</button>
            <button className="be-btn-primary">Speichern</button>
            <button className="be-delete-btn">x</button>
            <span className="drag-handle">&#x2807;</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="admin-button primary" style={{ flex: 'none', minWidth: 'auto' }}>Primary</button>
            <button className="admin-button danger" style={{ flex: 'none', minWidth: 'auto' }}>Danger</button>
            <button className="admin-button secondary" style={{ flex: 'none', minWidth: 'auto' }}>Secondary</button>
          </div>
        </div>
      </Section>

      <Section title="Messages">
        <div className="message success" style={{ marginTop: 0 }}>Erfolgreich gespeichert!</div>
        <div className="message error">Fehler beim Speichern.</div>
      </Section>

      <Section title="States">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div className="be-loading" style={{ padding: 12 }}>Lade Daten...</div>
          <div className="be-empty" style={{ padding: 12 }}>Keine Eintraege vorhanden</div>
        </div>
      </Section>

      <Section title="Text Hierarchy">
        <div className="backend-card">
          <h3>Card Title</h3>
          <label className="be-label">Label</label>
          <span className="be-hint">Hint text — monospace path</span>
          <p style={{ color: 'rgba(var(--text-rgb), 0.87)', fontSize: 14, marginTop: 8 }}>Body text — 87% opacity</p>
          <p style={{ color: 'rgba(var(--text-rgb), 0.55)', fontSize: 14 }}>Secondary — 55% opacity</p>
          <p style={{ color: 'rgba(var(--text-rgb), 0.35)', fontSize: 14 }}>Tertiary — 35% opacity</p>
        </div>
      </Section>

      <Section title="Navigation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200, background: 'var(--admin-sidebar-bg)', borderRadius: 6, padding: '8px 0' }}>
          <button className="admin-nav-item active" style={{ width: '100%' }}>
            <span className="admin-nav-icon">⚙️</span>
            <span>Config</span>
          </button>
          <button className="admin-nav-item" style={{ width: '100%' }}>
            <span className="admin-nav-icon">🎲</span>
            <span>Spiele</span>
          </button>
          <button className="admin-nav-item" style={{ width: '100%' }}>
            <span className="admin-nav-icon">📁</span>
            <span>Assets</span>
          </button>
        </div>
      </Section>

      <Section title="Storage / Info">
        <div className="storage-viewer" style={{ maxHeight: 'none' }}>
          <div className="storage-item">
            <span className="storage-item-key">team1</span>
            <span className="storage-item-value">["Anna","Ben"]</span>
          </div>
          <div className="storage-item">
            <span className="storage-item-key">team1Points</span>
            <span className="storage-item-value">12</span>
          </div>
        </div>
      </Section>

      <Section title="Progress Bar">
        <div className="backend-card">
          <div className="upload-progress-track" style={{ height: 6, background: 'rgba(var(--glass-rgb), 0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div className="upload-progress-fill" style={{ height: '100%', width: '65%', background: 'var(--admin-accent)', borderRadius: 3 }} />
          </div>
        </div>
      </Section>

      <Section title="Aktive Prozesse (unified job list)">
        <div className="backend-card">
          <h3>Aktive Prozesse</h3>
          <JobRowShowcase />
        </div>
      </Section>
    </div>
  );
}

export default function ThemeShowcase() {
  const { theme: globalTheme, adminTheme: globalAdminTheme, setGameThemeOverride } = useTheme();
  const [previewTheme, setPreviewThemeState] = useState<ThemeId>(globalTheme);
  const [previewAdminTheme, setPreviewAdminTheme] = useState<ThemeId>(globalAdminTheme);

  // Sync preview theme to <html> so page-level decorations match
  const setPreviewTheme = (id: ThemeId) => {
    setPreviewThemeState(id);
    setGameThemeOverride(id, true);
  };

  // Clear override when leaving the showcase
  useEffect(() => () => { setGameThemeOverride(null, true); }, [setGameThemeOverride]);

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'auto',
      background: '#111', zIndex: 2,
      fontSize: 14, textAlign: 'left',
    }}>
      <div style={{ padding: '24px max(20px, calc((100% - 1400px) / 2))', maxWidth: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center', marginBottom: 24 }}>
          <Link to="/admin#config" style={{ color: '#93c5fd', textDecoration: 'none', fontSize: 14, justifySelf: 'start' }}>← Zurück zum Admin</Link>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: '#e2e8f0', textAlign: 'center' }}>Theme Showcase</h2>
          <div />
        </div>

        {/* ── Frontend section — fully self-contained theme scope ── */}
        {/* font-size comes from a CSS rule on .theme-preview-panel[data-theme=...]
            in themes.css so per-theme overrides (e.g. Retro's VT323 bump) apply
            here too. Inline styles here would defeat that. */}
        <div className="theme-preview-panel theme-preview-panel-frontend" data-theme={previewTheme} style={{
          background: 'linear-gradient(135deg, var(--bg-gradient-from), var(--bg-gradient-to))',
          borderRadius: 12,
          padding: 'clamp(20px, 3vw, 40px)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-primary)',
          textAlign: 'center',
          marginBottom: 32,
          isolation: 'isolate',
          overflow: 'hidden',
        }}>
          <div style={{ textAlign: 'left', marginBottom: 20 }}>
            <h2 style={{ fontSize: '0.7em', fontWeight: 700, marginBottom: 10, color: 'rgba(var(--text-rgb), 0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Frontend / Gameshow</h2>
            <ThemeRow value={previewTheme} onChange={setPreviewTheme} />
          </div>
          <FrontendShowcase />
        </div>

        {/* ── Admin section — fully self-contained theme scope ── */}
        <div className="theme-preview-panel" data-theme={previewAdminTheme} style={{
          background: 'linear-gradient(135deg, var(--bg-gradient-from), var(--bg-gradient-to))',
          borderRadius: 12,
          padding: 'clamp(16px, 2vw, 32px)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-primary)',
          textAlign: 'left',
          maxWidth: 900,
          isolation: 'isolate',
          overflow: 'hidden',
        }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: 'rgba(var(--text-rgb), 0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Admin / Backend</h2>
            <ThemeRow value={previewAdminTheme} onChange={setPreviewAdminTheme} />
          </div>
          <AdminShowcase />
        </div>
      </div>
    </div>
  );
}
