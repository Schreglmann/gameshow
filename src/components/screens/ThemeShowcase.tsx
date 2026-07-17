import { useState, useEffect } from 'react';
import { useTheme, THEMES, ADMIN_THEMES, THEME_SWATCHES } from '@/context/ThemeContext';
import type { ThemeId } from '@/context/ThemeContext';
import { JobRow, type UnifiedJob } from '@/components/backend/SystemTab';
import { JOKER_CATALOG, getJoker } from '@/data/jokers';
import JokerIcon from '@/components/common/JokerIcon';
import DeadlineTimer from '@/components/common/DeadlineTimer';
import { ColorPie } from '@/components/games/ColorGuess';
import { QRCodeSVG } from 'qrcode.react';
import RulesEditor from '@/components/backend/RulesEditor';
import SpellCheckPanel, { type SpellGroup } from '@/components/backend/SpellCheckPanel';
import { SpellCheckProvider, type SpellCheckCtxValue } from '@/components/backend/SpellCheckContext';
import SpellField from '@/components/backend/SpellField';
import type { SpellMatch } from '@/services/backendApi';
import NavIcon from '@/components/backend/AdminNavIcons';
import ConflictBanner from '@/components/backend/ConflictBanner';
import RetryImage from '@/components/common/RetryImage';
import AssetReloadButton from '@/components/common/AssetReloadButton';
import type { RulesPreset } from '@/types/config';
import '@/admin.css';
import '@/backend.css';
import '@/styles/gamemaster.css';
import '@/styles/header-jokers.css';
import '@/styles/install-button.css';
import '@/styles/inactive-show-overlay.css';

const SPELL_DEMO_GROUPS: SpellGroup[] = [
  {
    key: 'allgemeinwissen::v1',
    groupLabel: 'Allgemeinwissen · v1',
    issues: [
      {
        id: 'demo-spelling',
        label: 'Frage 3 · Antwort',
        text: 'Die Hauptstdat von Frankreich.',
        match: {
          message: 'Möglicher Rechtschreibfehler gefunden.',
          shortMessage: 'Rechtschreibfehler',
          offset: 4,
          length: 10,
          replacements: ['Hauptstadt'],
          ruleId: 'GERMAN_SPELLER_RULE',
          issueType: 'misspelling',
          categoryId: 'TYPOS',
          categoryName: 'Mögliche Tippfehler',
          fingerprint: 'GERMAN_SPELLER_RULE::hauptstdat',
        },
      },
      {
        id: 'demo-grammar',
        label: 'Frage 5 · Fragetext',
        text: 'Wem gab er dem Buch?',
        match: {
          message: 'Im Akkusativ heißt es „das Buch“.',
          shortMessage: 'Kasusfehler',
          offset: 11,
          length: 3,
          replacements: ['das'],
          ruleId: 'DE_AGREEMENT',
          issueType: 'grammar',
          categoryId: 'GRAMMAR',
          categoryName: 'Grammatik',
          fingerprint: 'DE_AGREEMENT::dem',
        },
      },
    ],
  },
  {
    key: 'staedte-quiz::v2',
    groupLabel: 'Städte-Quiz · v2',
    issues: [
      {
        id: 'demo-spelling-2',
        label: 'Frage 1 · Fragetext',
        text: 'In welchem Bundesland liegt Nürnburg?',
        match: {
          message: 'Möglicher Rechtschreibfehler gefunden.',
          shortMessage: 'Rechtschreibfehler',
          offset: 28,
          length: 8,
          replacements: ['Nürnberg'],
          ruleId: 'GERMAN_SPELLER_RULE',
          issueType: 'misspelling',
          categoryId: 'TYPOS',
          categoryName: 'Mögliche Tippfehler',
          fingerprint: 'GERMAN_SPELLER_RULE::nürnburg',
        },
      },
    ],
  },
];

// Lektorat showcase demo data (inline underlines + popover) — see specs/spellcheck.md.
const SPELL_DEMO_SPELLING_MATCH: SpellMatch = {
  message: 'Möglicher Tippfehler gefunden.', shortMessage: 'Rechtschreibfehler', offset: 4, length: 10,
  replacements: ['Hauptstadt'], ruleId: 'GERMAN_SPELLER_RULE', issueType: 'misspelling', categoryId: 'TYPOS',
  categoryName: 'Mögliche Tippfehler', fingerprint: 'GERMAN_SPELLER_RULE::hauptstdat',
};
const SPELL_DEMO_GRAMMAR_MATCH: SpellMatch = {
  message: 'Im Akkusativ heißt es „das Buch“.', shortMessage: 'Kasusfehler', offset: 11, length: 3,
  replacements: ['das'], ruleId: 'DE_AGREEMENT', issueType: 'grammar', categoryId: 'GRAMMAR',
  categoryName: 'Grammatik', fingerprint: 'DE_AGREEMENT::dem',
};
const SPELL_DEMO_CTX: SpellCheckCtxValue = {
  enabled: true,
  getMatches: (segKey) => (segKey === 'demoSpelling' ? [SPELL_DEMO_SPELLING_MATCH] : segKey === 'demoGrammar' ? [SPELL_DEMO_GRAMMAR_MATCH] : []),
  apply: () => {},
  allowWord: () => {},
  ignore: () => {},
};

// Admin row passes `themes={ADMIN_THEMES}` (curated subset); frontend row uses all THEMES.
function ThemeRow({ value, onChange, themes = THEMES }: { value: ThemeId; onChange: (id: ThemeId) => void; themes?: typeof THEMES }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {themes.map(t => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            className="theme-option"
            style={active ? { borderColor: 'var(--admin-accent)', background: 'rgba(var(--admin-accent-rgb), 0.1)' } : undefined}
            onClick={() => onChange(t.id)}
          >
            <div className="theme-preview" style={{ background: THEME_SWATCHES[t.id] }} />
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
      <h3 style={{ textAlign: 'left', marginBottom: 12, fontSize: '0.95em', borderBottom: '1px solid rgba(var(--glass-rgb), 0.15)', paddingBottom: 6, color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h3>
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
  // Stable far-future deadline so the showcase ring renders a steady value
  // (~45s of 60s) instead of restarting every render.
  const [showcaseDeadlineEndsAt] = useState(() => Date.now() + 45000);
  return (
    <div>
      <Section title="Header">
        <header style={{ position: 'relative', animation: 'none' }}>
          <div className="team-header-cell team-header-team1">
            <span className="team-header-label">
              <span className="team-header-name">Team 1</span>
              <span className="team-header-score">: <span>12</span> Punkte</span>
            </span>
          </div>
          <div id="gameNumber">Spiel 3 von 8</div>
          <div className="team-header-cell team-header-team2">
            <span className="team-header-label">
              <span className="team-header-name">Team 2</span>
              <span className="team-header-score">: <span>9</span> Punkte</span>
            </span>
          </div>
        </header>
      </Section>

      <Section title="Führungswechsel-Banner (Lead Change)">
        <header style={{ position: 'relative', animation: 'none', marginBottom: 56 }}>
          <div className="team-header-cell team-header-team1">
            <span className="team-header-label">
              <span className="team-header-name">Team 1</span>
              <span className="team-header-score">: <span>9</span> Punkte</span>
            </span>
          </div>
          <div id="gameNumber">Spiel 4 von 8</div>
          <div className="team-header-cell team-header-team2">
            <span className="team-header-label">
              <span className="team-header-name">Team 2</span>
              <span className="team-header-score">: <span>12</span> Punkte</span>
            </span>
          </div>
          <div className="fuehrungswechsel-banner" style={{ animation: 'none' }}>
            Führungswechsel! <span className="fuehrungswechsel-leader">Team 2</span> führt
          </div>
        </header>
      </Section>

      <Section title="Typography">
        <h1 style={{ marginTop: 0 }}>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3 style={{ marginBottom: 8 }}>Heading 3</h3>
        <GlassCard>
          <p style={{ color: 'var(--text-primary)', marginBottom: 4 }}>Primary text on glass card</p>
          <p style={{ color: 'rgba(var(--text-rgb), max(0.7, var(--text-fade-floor, 0)))', marginBottom: 4 }}>Secondary text (70%)</p>
          <p style={{ color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', marginBottom: 4 }}>Muted text (50%)</p>
          <p style={{ color: 'rgba(var(--text-rgb), max(0.35, var(--text-fade-floor, 0)))' }}>Faint text (35%)</p>
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

      <Section title="PWA Install Button">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
          <button type="button" className="install-button install-button--frontend" style={{ marginTop: 0 }}>
            <span aria-hidden="true" className="install-button-icon">⤓</span>
            <span>App installieren</span>
          </button>
          <button type="button" className="install-button install-button--gamemaster" style={{ position: 'static' }}>
            <span aria-hidden="true" className="install-button-icon">⤓</span>
            <span>Gamemaster installieren</span>
          </button>
        </div>
      </Section>

      <Section title="Inactive Show Overlay">
        {/* Match the real .inactive-show-overlay veil (0.82 black) — the card
            hardcodes white text for that surface. */}
        <div style={{ position: 'relative', minHeight: 220, padding: 16, borderRadius: 12, background: 'rgba(0, 0, 0, 0.82)' }}>
          <div className="inactive-show-card" style={{ position: 'relative', margin: '0 auto' }}>
            <h2>Dieses Frontend ist nicht aktiv</h2>
            <p>Ein anderes Frontend ist aktuell als Haupt-Frontend registriert. Um Inhalte hier anzuzeigen und zu kontrollieren, musst du übernehmen.</p>
            <button type="button" className="inactive-show-claim-btn">Als Haupt-Frontend übernehmen</button>
          </div>
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

      <Section title="Bet Quiz — Kategorie-Enthüllung">
        <GlassCard>
          <div className="quiz-question-number">Frage 2 von 8</div>
          <div className="bet-quiz-category">Geografie</div>
        </GlassCard>
      </Section>

      <Section title="Bet Quiz — Einsatz-Banner">
        <GlassCard>
          <div className="bet-quiz-banner">
            <span className="bet-quiz-banner-team">Team 1</span>
            <span className="bet-quiz-banner-members"> · Alice, Bob</span>
            <span className="bet-quiz-banner-bet"> · Einsatz: 12 Punkte</span>
          </div>
          <div className="quiz-question-number">Frage 2 von 8</div>
          <div className="quiz-question">Welche Stadt ist die Hauptstadt von Australien?</div>
          <div className="quiz-answer" style={{ animation: 'none' }}>
            <p>Canberra</p>
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

      <Section title="Wer kennt mehr? — Beispiele (kompaktes Raster)">
        <GlassCard>
          <div className="quiz-question" style={{ marginBottom: 12 }}>Nennt so viele Bundesländer wie möglich.</div>
          <div className="quiz-answer" style={{ animation: 'none' }}>
            <ul className="wkm-examples">
              {['Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg',
                'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen',
                'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt',
                'Schleswig-Holstein', 'Thüringen'].map(s => <li key={s}>{s}</li>)}
            </ul>
          </div>
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

      <Section title="Retry Image (loaded vs final failure)">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          <GlassCard style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <div className="quiz-question-number">Geladen</div>
            <RetryImage className="quiz-image" src={PLACEHOLDER_IMG} alt="Platzhalter" style={{ maxHeight: 140 }} />
          </GlassCard>
          <GlassCard style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <div className="quiz-question-number">Fehler (Browser-Default)</div>
            <RetryImage className="quiz-image" src="/does-not-exist.png" alt="Fehler-Platzhalter" maxRetries={0} style={{ maxHeight: 140 }} />
          </GlassCard>
        </div>
      </Section>

      <Section title="Asset Reload Button (frontend fallback when no GM is connected)">
        <GlassCard>
          <div className="quiz-question-number">Audio konnte nicht geladen werden</div>
          <div className="asset-reload-button-wrap">
            <AssetReloadButton onClick={() => undefined} />
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

      <Section title="Gamemaster Toolbar Toggles">
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <button
              type="button"
              className="gm-lock-toggle"
              aria-pressed={false}
              title="Klicks und Tasten in der Gamemaster-Ansicht sperren, damit nichts versehentlich weitergeschaltet wird. Weiter/Zurück bleiben aktiv."
            >
              Steuerung sperren
            </button>
            <button
              type="button"
              className="gm-images-toggle"
              aria-pressed={false}
              title="Antwort-Bilder sind ausgeblendet. Klicken zum Einblenden."
            >
              Bilder einblenden
            </button>
            <button
              type="button"
              className="gm-next-toggle"
              aria-pressed={false}
              title="Die nächste Frage samt Antwort wird beim Auflösen mit angezeigt. Klicken zum Ausblenden."
            >
              Nächste Frage ausblenden
            </button>
            <div className="gm-deadline-group" role="group" aria-label="Deadline-Timer (Demo)">
              <div className="gm-deadline-durations" role="group" aria-label="Countdown-Dauer wählen (Demo)">
                <div className="gm-deadline-durations-label">Countdown</div>
                <div className="gm-deadline-durations-grid">
                  <button type="button" className="gm-deadline-segment">30s</button>
                  <button type="button" className="gm-deadline-segment">60s</button>
                  <button type="button" className="gm-deadline-segment">90s</button>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <button
              type="button"
              className="gm-lock-toggle gm-lock-toggle--locked"
              aria-pressed={true}
              title="Klick- und Tastatursteuerung der Show ist gesperrt. Klicken zum Entsperren."
            >
              Steuerung gesperrt
            </button>
            <button
              type="button"
              className="gm-images-toggle gm-images-toggle--showing"
              aria-pressed={true}
              title="Antwort-Bilder werden angezeigt. Klicken zum Ausblenden."
            >
              Bilder ausblenden
            </button>
            <button
              type="button"
              className="gm-next-toggle gm-next-toggle--hidden"
              aria-pressed={true}
              title="Die nächste Frage ist ausgeblendet. Klicken zum Einblenden."
            >
              Nächste Frage einblenden
            </button>
            <div className="gm-deadline-group" role="group" aria-label="Deadline-Timer aktiv (Demo)">
              <div className="gm-deadline-durations" role="group" aria-label="Countdown-Dauer wählen aktiv (Demo)">
                <div className="gm-deadline-durations-label">Countdown</div>
                <div className="gm-deadline-durations-grid">
                  <button type="button" className="gm-deadline-segment">30s</button>
                  <button type="button" className="gm-deadline-segment">60s</button>
                  <button type="button" className="gm-deadline-segment">90s</button>
                </div>
              </div>
              <div className="gm-deadline-ring">
                <DeadlineTimer endsAt={showcaseDeadlineEndsAt} totalSeconds={60} silent />
              </div>
              <button type="button" className="gm-deadline-btn gm-deadline-btn--extend">+10s</button>
              <button type="button" className="gm-deadline-btn gm-deadline-btn--pause">Pause</button>
              <button type="button" className="gm-deadline-btn gm-deadline-btn--stop">Stop</button>
            </div>
            <div className="gm-scroll-group" role="group" aria-label="Show scrollen (Demo)">
              <div className="gm-scroll-label">Scrollen</div>
              <div className="gm-scroll-grid">
                <button type="button" className="gm-scroll-btn">⤒ Anfang</button>
                <button type="button" className="gm-scroll-btn">Antwort</button>
                <button type="button" className="gm-scroll-btn">⤓ Ende</button>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Gamemaster Next-Answer Preview">
        <div className="gamemaster-card" style={{ textAlign: 'center' }}>
          <div className="gamemaster-meta">Frage 3 / 10</div>
          <div className="gamemaster-title">Allgemeinwissen</div>
          <div className="gamemaster-question">Welcher Fluss ist der längste der Welt?</div>
          <div className="gamemaster-answer">Nil</div>
          <div className="gamemaster-next">
            <div className="gamemaster-next-label">Nächste Frage</div>
            <div className="gamemaster-next-question">Wie viele Planeten hat unser Sonnensystem?</div>
            <div className="gamemaster-next-answer">8</div>
          </div>
        </div>
      </Section>

      <Section title="Gamemaster Desync Warning">
        <div className="gm-desync-banner" role="alert">
          <div className="gm-desync-text">
            <strong className="gm-desync-title">Anzeige möglicherweise veraltet</strong>
            <span className="gm-desync-detail">
              Die angezeigte Antwort passt nicht zur aktuellen Spielphase. Synchronisiere neu, um die aktuelle Antwort zu laden.
            </span>
          </div>
          <button type="button" className="gm-btn gm-btn--primary gm-desync-btn">
            Jetzt synchronisieren
          </button>
        </div>
      </Section>

      <Section title="Gamemaster Score-History (Undo)">
        <div className="gm-score-history">
          <button type="button" className="gm-score-history-header" aria-expanded="true">
            <span className="gm-score-history-title">Letzte Wertungen</span>
            <span className="gm-score-history-count" aria-hidden="true">3</span>
            <span className="gm-score-history-chevron" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
          <ul className="gm-score-history-list">
            <li className="gm-score-history-item">
              <span className="gm-score-delta positive">+3</span>
              <span className="gm-score-history-meta">
                <span className="gm-score-history-team">Die Adler</span>
                <span className="gm-score-history-game">Spiel 3</span>
              </span>
              <button type="button" className="gm-btn gm-btn--danger gm-score-undo">Rückgängig</button>
            </li>
            <li className="gm-score-history-item">
              <span className="gm-score-delta negative">−2</span>
              <span className="gm-score-history-meta">
                <span className="gm-score-history-team">Quizfüchse</span>
                <span className="gm-score-history-game">Spiel 2</span>
              </span>
              <button type="button" className="gm-btn gm-btn--danger gm-score-undo">Rückgängig</button>
            </li>
          </ul>
        </div>
      </Section>

      <Section title="Gamemaster Pause-Hold + Joker-Bestätigung">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <button type="button" className="gm-hold-toggle gm-hold-toggle--active">Pause beenden</button>
          <div className="show-hold-card" style={{ border: '1px solid rgba(var(--glass-rgb), 0.2)', borderRadius: 16, background: 'rgba(var(--glass-rgb), 0.08)' }}>
            <div className="show-hold-icon" aria-hidden="true">⏸</div>
            <div className="show-hold-title">Gleich geht&apos;s weiter</div>
            <div className="show-hold-message">Kurze Pause — wir machen gleich weiter.</div>
          </div>
          <div className="gm-joker-confirm">
            <span className="gm-joker-confirm-team">Die Adler</span>
            <span className="gm-joker-confirm-name">Telefonjoker</span>
            <span className="gm-joker-confirm-desc">Team ruft eine Person an. Antwortet sie nicht, entscheidet der GM, ob der Joker verbraucht ist.</span>
          </div>
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
            <button className="award-team-button">
              Team 1
              <span className="award-double-badge" title="Aufholjoker: Punkte zählen doppelt">×2 Aufholjoker</span>
            </button>
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

      <Section title="Statement cards (Q1 / Four Statements)">
        <div className="statements-container" style={{ maxWidth: 500, margin: '0 auto' }}>
          <div className="statement">Ich war schon einmal in Japan</div>
          <div className="statement" style={{ background: 'rgba(var(--glass-rgb), 0.2)' }}>Ich kann Klavier spielen (hover)</div>
          <div className="statement" style={{ background: 'rgba(74, 222, 128, 0.3)', borderColor: 'rgba(74, 222, 128, 0.6)' }}>Wahre Aussage (Q1 grün)</div>
          <div className="statement" style={{ background: 'rgba(255, 59, 48, 0.3)', borderColor: 'rgba(255, 59, 48, 0.6)' }}>Falsche Aussage (Q1 rot)</div>
          <div className="statement" style={{ background: 'rgba(var(--card-success-rgb, var(--success-rgb)), 0.2)', borderColor: 'rgba(var(--card-success-rgb, var(--success-rgb)), 0.7)', borderWidth: 2, color: 'var(--card-success, var(--success))', fontSize: '1.5em', fontWeight: 700, textAlign: 'center' }}>Lösung (Four Statements)</div>
        </div>
      </Section>

      <Section title="Ranking rows (ordered-answer reveal)">
        <div className="quiz-question" style={{ textAlign: 'center' }}>Top 5 umsatzstärkste Filme 2023 – in absteigender Reihenfolge</div>
        <div className="ranking-topic">Optionaler Untertitel</div>
        <div className="statements-container" style={{ maxWidth: 500, margin: '0 auto' }}>
          <div className="statement ranking-row">
            <span className="ranking-rank">1.</span>
            <span className="ranking-text">Barbie</span>
          </div>
          <div className="statement ranking-row">
            <span className="ranking-rank">2.</span>
            <span className="ranking-text">The Super Mario Bros. Movie</span>
          </div>
          <div className="statement ranking-row ranking-row--last">
            <span className="ranking-rank">3.</span>
            <span className="ranking-text">Oppenheimer</span>
          </div>
        </div>
      </Section>

      <Section title="Ranking item pool (items – guessing phase)">
        <div className="quiz-question" style={{ textAlign: 'center' }}>Ordne diese Länder nach ihrer Fläche – das größte zuerst</div>
        <div className="ranking-pool-label">Diese Elemente in die richtige Reihenfolge bringen:</div>
        <div className="statements-container" style={{ maxWidth: 500, margin: '0 auto' }}>
          <div className="statement ranking-row ranking-pool-row">
            <span className="ranking-rank ranking-pool-bullet" aria-hidden="true">•</span>
            <span className="ranking-text">China</span>
          </div>
          <div className="statement ranking-row ranking-pool-row">
            <span className="ranking-rank ranking-pool-bullet" aria-hidden="true">•</span>
            <span className="ranking-text">Russland</span>
          </div>
          <div className="statement ranking-row ranking-pool-row">
            <span className="ranking-rank ranking-pool-bullet" aria-hidden="true">•</span>
            <span className="ranking-text">Kanada</span>
          </div>
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

      <Section title="Color Guess (Pie Chart)">
        <GlassCard>
          <div style={{ display: 'flex', justifyContent: 'center', maxWidth: 320, margin: '0 auto' }}>
            <ColorPie
              colors={[
                { hex: '#1E90FF', percent: 52 },
                { hex: '#34A853', percent: 28 },
                { hex: '#FBBC05', percent: 14 },
                { hex: '#EA4335', percent: 6 },
              ]}
              highlightIdx={null}
              onHighlight={() => {}}
            />
          </div>
          <div className="color-guess-tooltip">Hover über ein Segment für den Farbcode</div>
        </GlassCard>
      </Section>

      <Section title="Form / Name Entry">
        <div className="name-form" style={{ marginBottom: 0 }}>
          <h2 style={{ fontSize: '1.4em' }}>Namen zuweisen</h2>
          <textarea placeholder="Name 1, Name 2, ..." style={{ height: 80, margin: 0 }} readOnly />
          <button>Teams zuweisen</button>
        </div>
      </Section>

      <Section title="Team-Name bearbeiten (Klick auf Überschrift)">
        <div className="team" style={{ minWidth: 220 }}>
          <h2 className="team-name-editable" title="Zum Umbenennen klicken">Die Unbesiegbaren Adler</h2>
        </div>
        <div className="team" style={{ minWidth: 220, marginTop: 12 }}>
          <input className="team-name-edit-input" defaultValue="Die Unbesiegbaren Adler" readOnly />
          <p className="team-name-hint" role="status">
            Name ist zu lang – wird im Punkte-Header auf kleineren Bildschirmen abgekürzt (mit 3 Jokern weniger Platz).
          </p>
        </div>
      </Section>

      <Section title="Team-Roster bearbeiten (inline)">
        <div className="team" style={{ minWidth: 260 }}>
          <h2 className="team-name-editable" title="Zum Umbenennen klicken">Team 1</h2>
          <ul className="team-members team-members-editable">
            <li className="team-member-row">
              <input className="team-member-input" defaultValue="Anna" readOnly />
            </li>
            <li className="team-member-row">
              <input className="team-member-input" defaultValue="Ben" readOnly />
            </li>
            <li className="team-member-row">
              <input className="team-member-input" placeholder="+ Spieler hinzufügen" readOnly />
            </li>
          </ul>
        </div>
      </Section>

      <Section title="Team Cards">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div className="team" style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ fontSize: '1.2em' }}>Team 1</h2>
            <p style={{ color: 'rgba(var(--text-rgb), max(0.7, var(--text-fade-floor, 0)))' }}>Anna, Ben, Clara</p>
            <p style={{ fontSize: '1.5em', fontWeight: 700, marginTop: 8 }}>12 Punkte</p>
          </div>
          <div className="team" style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ fontSize: '1.2em' }}>Team 2</h2>
            <p style={{ color: 'rgba(var(--text-rgb), max(0.7, var(--text-fade-floor, 0)))' }}>David, Eva, Finn</p>
            <p style={{ fontSize: '1.5em', fontWeight: 700, marginTop: 8 }}>9 Punkte</p>
          </div>
        </div>
      </Section>

      <Section title="Rules Container">
        <div className="rules-container" style={{ width: '100%', margin: 0, animation: 'none' }}>
          <h1 style={{ fontSize: '1.4em', textShadow: 'none', marginTop: 0 }}>Spielregeln</h1>
          <ul style={{ textAlign: 'left', listStyleType: 'disc', paddingLeft: 24, marginBottom: 0 }}>
            <li style={{ padding: '6px 0', border: 'none' }}>Jedes Team beantwortet abwechselnd</li>
            <li style={{ padding: '6px 0', border: 'none' }}>Pro richtige Antwort gibt es Punkte</li>
          </ul>
        </div>
      </Section>

      <Section title="Loading Spinner">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="video-loading-spinner" />
        </div>
      </Section>

      <Section title="Header Jokers">
        <HeaderJokersShowcase />
      </Section>
    </div>
  );
}

function HeaderJokersShowcase() {
  const sampleIds = JOKER_CATALOG.slice(0, 4).map(j => j.id);
  const firstId = JOKER_CATALOG[0]?.id ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <HeaderJokersRowPreview
        heading="Normal — 4 verfügbar, 1 verbraucht (Team 1)"
        enabled={sampleIds}
        team1Used={[firstId]}
        team2Used={[]}
        isLastGame={false}
      />
      <HeaderJokersRowPreview
        heading="Letztes Spiel ohne Freigabe — komplett ausgeblendet"
        enabled={sampleIds}
        team1Used={[firstId]}
        team2Used={[]}
        isLastGame
      />
      <HeaderJokersRowPreview
        heading="Aufholjoker — gesperrt für das führende Team (Team 1), verfügbar für das zurückliegende (Team 2)"
        enabled={[...sampleIds, 'comeback']}
        team1Used={[]}
        team2Used={[]}
        team1Locked={['comeback']}
        isLastGame={false}
      />
      <HeaderJokersRowPreview
        heading="Keine Joker aktiviert — gar nichts rendert"
        enabled={[]}
        team1Used={[]}
        team2Used={[]}
        isLastGame={false}
      />
    </div>
  );
}

interface HeaderJokersRowPreviewProps {
  heading: string;
  enabled: string[];
  team1Used: string[];
  team2Used: string[];
  isLastGame: boolean;
  team1Locked?: string[];
  team2Locked?: string[];
}

function HeaderJokersRowPreview({ heading, enabled, team1Used, team2Used, isLastGame, team1Locked, team2Locked }: HeaderJokersRowPreviewProps) {
  // Empty-state: nothing renders either when no jokers are enabled, or in the
  // last game when the gameshow doesn't allow jokers there (default).
  if (enabled.length === 0 || isLastGame) {
    const note = isLastGame
      ? '(Im letzten Spiel werden alle Joker komplett ausgeblendet, sofern nicht freigegeben.)'
      : '(Nichts wird gerendert, wenn keine Joker aktiviert sind.)';
    return (
      <div>
        <div style={{ fontSize: '0.85em', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))', marginBottom: 8 }}>
          {heading}
        </div>
        <div style={{ fontStyle: 'italic', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))' }}>
          {note}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: '0.85em', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))', marginBottom: 8 }}>
        {heading}
      </div>
      <header style={{ position: 'relative', animation: 'none' }}>
        <div className="team-header-cell team-header-team1">
          <span className="team-header-label">
            <span className="team-header-name">Team 1</span>
            <span className="team-header-score">: <span>7</span> Punkte</span>
          </span>
          <HeaderJokersPreviewRow team="team1" enabled={enabled} used={team1Used} lockedIds={team1Locked} />
        </div>
        <div id="gameNumber">Spiel 3 von 8</div>
        <div className="team-header-cell team-header-team2">
          <HeaderJokersPreviewRow team="team2" enabled={enabled} used={team2Used} lockedIds={team2Locked} />
          <span className="team-header-label">
            <span className="team-header-name">Team 2</span>
            <span className="team-header-score">: <span>5</span> Punkte</span>
          </span>
        </div>
      </header>
    </div>
  );
}

interface HeaderJokersPreviewRowProps {
  team: 'team1' | 'team2';
  enabled: string[];
  used: string[];
  lockedIds?: string[];
}

function HeaderJokersPreviewRow({ team, enabled, used, lockedIds = [] }: HeaderJokersPreviewRowProps) {
  return (
    <div className={`header-jokers header-jokers-${team}`} role="group" aria-label="Joker (Vorschau)">
      {enabled.map(id => {
        const def = getJoker(id);
        if (!def) return null;
        const isUsed = used.includes(id);
        const locked = lockedIds.includes(id) && !isUsed;
        const tooltip = `${def.name} — ${def.description}`;
        return (
          <button
            key={id}
            type="button"
            className={`header-joker${isUsed ? ' header-joker-used' : ''}${locked ? ' header-joker-locked' : ''}`}
            aria-label={tooltip}
            aria-pressed={isUsed}
            data-tooltip={tooltip}
          >
            <span className="header-joker-svg" aria-hidden="true">
              <JokerIcon id={id} size={18} />
            </span>
          </button>
        );
      })}
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

const DEMO_PRESETS: RulesPreset[] = [
  { id: 'demo-a', name: 'Gleichzeitig schriftlich', rules: ['Jede Frage wird beiden Teams gleichzeitig gestellt.', 'Die Teams schreiben ihre Antwort auf.'] },
  { id: 'demo-b', name: 'Abwechselnd', rules: ['Die Teams raten abwechselnd.', 'Antwortet ein Team falsch oder nicht, darf das andere Team antworten.'] },
  { id: 'demo-c', name: 'Gleichzeitig (erste richtige gewinnt)', rules: ['Beide Teams raten gleichzeitig.', 'Die erste richtige Antwort gewinnt.', 'Die Teams dürfen beliebig oft raten.'] },
];

function LiveRulesEditorDemo() {
  const [rules, setRules] = useState<string[]>([
    'Es muss die Firma anhand des Logos erraten werden.',
    'Eigene Regel A.',
    'Eigene Regel B.',
    'Eigene Regel C.',
  ]);
  const [activePresetId, setActivePresetId] = useState<string | undefined>(undefined);
  const [randomize, setRandomize] = useState(false);
  const [limit, setLimit] = useState<string>('');
  return (
    <RulesEditor
      rules={rules}
      onChange={setRules}
      taskLine
      presets={DEMO_PRESETS}
      activePresetId={activePresetId}
      onPresetChange={setActivePresetId}
      extraCenter={
        <label className="be-toggle">
          <input type="checkbox" checked={randomize} onChange={e => setRandomize(e.target.checked)} />
          <span className="be-toggle-track" />
          <span className="be-toggle-label">Fragen zufällig anordnen</span>
        </label>
      }
      extra={
        <label className="be-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="be-toggle-label">Fragen limitieren auf</span>
          <input
            type="number"
            min={1}
            className="be-input"
            style={{ width: 70 }}
            value={limit}
            placeholder="–"
            onChange={e => setLimit(e.target.value)}
          />
        </label>
      }
    />
  );
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
          <label className="be-label">Team 1 Name (optional)</label>
          <input className="be-input" defaultValue="Die Unbesiegbaren Adler" readOnly />
          <p className="be-field-hint" role="status">
            Name ist zu lang – wird im Header auf kleineren Bildschirmen abgekürzt (mit 3 Jokern weniger Platz).
          </p>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="install-button install-button--admin">
              <span aria-hidden="true" className="install-button-icon">⤓</span>
              <span>Admin installieren</span>
            </button>
          </div>
        </div>
      </Section>

      <Section title="Spiele tab — empty state (Beispiele erstellen)">
        <div className="backend-card">
          <div className="be-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <p style={{ margin: 0 }}>Noch keine Spiele vorhanden.</p>
            <button className="admin-button primary">Beispiele erstellen</button>
            <p style={{ margin: 0, fontSize: 'clamp(0.8rem, 1.6vw, 0.9rem)', opacity: 0.7, maxWidth: 420, textAlign: 'center' }}>
              Legt für jede Spielart ein Beispielspiel mit echten Fragen an – inklusive selbst erzeugter, lizenzfreier Bilder und Musik.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Rules editor (per-game)">
        <div className="backend-card">
          <label className="be-label">Regeln (mit Vorlage — Vorlagen-Buttons ausgeklappt)</label>
          <div className="be-list-row be-task-row">
            <span className="be-aufgabe-badge">Aufgabe</span>
            <input className="be-input" defaultValue="Es muss die Firma anhand des Logos erraten werden." readOnly />
            <span className="be-delete-btn-spacer" aria-hidden="true" />
          </div>
          <div className="be-rules-divider" />
          <div className="be-list-row be-rule-locked">
            <span className="drag-handle be-drag-disabled" aria-hidden="true">⠿</span>
            <div className="be-input be-rule-locked-text">Die Teams raten abwechselnd.</div>
            <span className="be-delete-btn-spacer" aria-hidden="true" />
          </div>
          <div className="be-list-row be-rule-locked">
            <span className="drag-handle be-drag-disabled" aria-hidden="true">⠿</span>
            <div className="be-input be-rule-locked-text">Antwortet ein Team falsch oder nicht, darf das andere Team antworten.</div>
            <span className="be-delete-btn-spacer" aria-hidden="true" />
          </div>
          <div className="be-rules-bottom-row">
            <div className="be-rules-bottom-left">
              <button className="be-icon-btn" type="button" disabled>+ Hinzufügen</button>
              <button type="button" className="be-icon-btn be-presets-toggle is-active">
                <span>Vorlage</span>
                <span className="be-presets-toggle-arrow" aria-hidden="true">▾</span>
              </button>
            </div>
            <div className="be-rules-bottom-center">
              <label className="be-toggle">
                <input type="checkbox" readOnly />
                <span className="be-toggle-track" />
                <span className="be-toggle-label">Fragen zufällig anordnen</span>
              </label>
            </div>
            <div className="be-rules-bottom-right">
              <label className="be-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="be-toggle-label">Fragen limitieren auf</span>
                <input type="number" className="be-input" style={{ width: 70 }} placeholder="–" readOnly />
              </label>
            </div>
          </div>
          <div className="be-preset-buttons">
            <button type="button" className="be-icon-btn">Gleichzeitig schriftlich</button>
            <button type="button" className="be-icon-btn is-active">Abwechselnd</button>
            <button type="button" className="be-icon-btn">Gleichzeitig (erste richtige gewinnt)</button>
          </div>

          <label className="be-label" style={{ marginTop: 20 }}>Regeln (ohne Vorlage — Vorlagen-Buttons eingeklappt)</label>
          <div className="be-list-row be-task-row">
            <span className="be-aufgabe-badge">Aufgabe</span>
            <input className="be-input" defaultValue="Beschreibe die Aufgabe der Runde." readOnly />
            <span className="be-delete-btn-spacer" aria-hidden="true" />
          </div>
          <div className="be-rules-divider" />
          <div className="be-list-row">
            <span className="drag-handle">⠿</span>
            <input className="be-input" defaultValue="Beide Teams raten gleichzeitig." readOnly />
            <button className="be-delete-btn" type="button">🗑</button>
          </div>
          <div className="be-rules-bottom-row">
            <div className="be-rules-bottom-left">
              <button className="be-icon-btn" type="button">+ Hinzufügen</button>
              <button type="button" className="be-icon-btn be-presets-toggle">
                <span>Vorlage</span>
                <span className="be-presets-toggle-arrow" aria-hidden="true">▾</span>
              </button>
            </div>
            <div className="be-rules-bottom-center">
              <label className="be-toggle">
                <input type="checkbox" readOnly />
                <span className="be-toggle-track" />
                <span className="be-toggle-label">Fragen zufällig anordnen</span>
              </label>
            </div>
            <div className="be-rules-bottom-right">
              <label className="be-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="be-toggle-label">Fragen limitieren auf</span>
                <input type="number" className="be-input" style={{ width: 70 }} placeholder="–" readOnly />
              </label>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Rules editor (interactive — click presets to verify layout stability)">
        <div className="backend-card">
          <LiveRulesEditorDemo />
        </div>
      </Section>

      <Section title="Rechtschreibprüfung">
        <div className="lektorat-master">
          <div className="lektorat-master-text">
            <span className="lektorat-master-title">Rechtschreibprüfung</span>
            <span className="lektorat-master-sub">Prüft alle Fragen, Antworten und Regeln auf deutsche Rechtschreib- und Grammatikfehler. Standardmäßig deaktiviert.</span>
          </div>
          <label className="be-toggle">
            <input type="checkbox" defaultChecked readOnly />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Aktiv</span>
          </label>
        </div>
        <div className="lt-server" style={{ marginTop: 12 }}>
          <div className="lt-server-head">
            <span className="lt-server-title">Lokaler LanguageTool-Server</span>
            <span className="lektorat-health lektorat-health--ok">Lokaler Server läuft</span>
            <button type="button" className="be-icon-btn danger">Server stoppen</button>
          </div>
          <span className="lt-server-hint">Lokaler Server = sofortige, unbegrenzte Prüfung (kein Ratenlimit). Der erste Start lädt einmalig ein ~500 MB Docker-Image.</span>
        </div>
        <div className="lt-server" style={{ marginTop: 12 }}>
          <div className="lt-server-head">
            <span className="lt-server-title">Lokaler LanguageTool-Server</span>
            <span className="lektorat-health lektorat-health--muted">Gestoppt</span>
            <button type="button" className="be-btn-primary">Server starten</button>
          </div>
          <span className="lt-server-hint">Lokaler Server = sofortige, unbegrenzte Prüfung (kein Ratenlimit). Der erste Start lädt einmalig ein ~500 MB Docker-Image.</span>
        </div>
        <div className="lt-server" style={{ marginTop: 12 }}>
          <div className="lt-server-head">
            <span className="lt-server-title">Lokaler LanguageTool-Server</span>
            <span className="lektorat-health lektorat-health--info">Image wird geladen…</span>
            <button type="button" className="be-icon-btn danger">Abbrechen</button>
          </div>
          <div className="lt-server-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={62}>
            <div className="lt-server-progress-fill" style={{ width: '62%' }} />
          </div>
          <span className="lt-server-hint">Image wird geladen… (5/8 Layer)</span>
        </div>
        <div className="backend-card" style={{ marginTop: 12 }}>
          <h3>Rechtschreibung &amp; Grammatik</h3>
          <SpellCheckPanel groups={SPELL_DEMO_GROUPS} onApply={() => {}} onAllowWord={() => {}} onIgnore={() => {}} />
        </div>
        <div className="backend-card" style={{ marginTop: 12 }}>
          <h3>Inline-Unterstreichungen (im Editor)</h3>
          <SpellCheckProvider value={SPELL_DEMO_CTX}>
            <label className="be-label">Antwort (Rechtschreibung – rot)</label>
            <SpellField segKey="demoSpelling" className="be-input" value="Die Hauptstdat ist schön" onChange={() => {}} readOnly />
            <label className="be-label" style={{ marginTop: 10 }}>Frage (Grammatik – blau)</label>
            <SpellField segKey="demoGrammar" className="be-input" value="Wem gab er dem Buch?" onChange={() => {}} readOnly />
          </SpellCheckProvider>
          <p className="be-hint" style={{ marginTop: 8 }}>Klick auf ein markiertes Wort öffnet das Korrektur-Popover:</p>
          <div style={{ position: 'relative', height: 170 }}>
            <div className="spell-popover" style={{ position: 'static' }} role="dialog">
              <div className="spell-popover-msg" title="Deutsche Rechtschreibprüfung: unbekanntes Wort – meist ein Eigenname.">Unbekanntes oder möglicherweise falsch geschriebenes Wort.</div>
              <div className="spell-popover-actions">
                <button type="button" className="be-btn-primary spell-popover-fix">„Hauptstadt“</button>
                <button type="button" className="be-icon-btn">Erlauben</button>
                <button type="button" className="be-icon-btn">Ignorieren</button>
                <button type="button" className="be-icon-btn">Schließen</button>
              </div>
              <div className="spell-popover-custom">
                <input className="be-input spell-popover-custom-input" defaultValue="Hauptstdat" aria-label="Eigene Korrektur" readOnly />
                <button type="button" className="be-icon-btn">Übernehmen</button>
              </div>
            </div>
          </div>
        </div>
        <div className="backend-card" style={{ marginTop: 12 }}>
          <h3>Wörterbuch</h3>
          <div className="spell-dict">
            <div className="spell-dict-option">
              <div className="spell-dict-option-text">
                <span className="spell-dict-option-title">Namen nicht prüfen</span>
                <span className="spell-dict-option-sub">Großgeschriebene Wörter ohne nahe Korrektur (Namen, Bands, Orte, Titel) werden nicht als Fehler markiert.</span>
              </div>
              <label className="be-toggle">
                <input type="checkbox" defaultChecked readOnly />
                <span className="be-toggle-track" />
                <span className="be-toggle-label">Aktiv</span>
              </label>
            </div>
            <section className="spell-dict-section">
              <h3 className="spell-dict-section-title">Erlaubte Wörter</h3>
              <p className="spell-dict-section-hint">Wörter, die nie als Rechtschreibfehler markiert werden.</p>
              <div className="spell-dict-add">
                <input className="be-input" placeholder="Wort hinzufügen…" readOnly />
                <button type="button" className="be-btn-primary">Hinzufügen</button>
              </div>
              <ul className="spell-dict-list">
                <li className="spell-dict-row">
                  <span className="spell-dict-word">Inception</span>
                  <span className="spell-dict-row-actions">
                    <button type="button" className="be-icon-btn">Bearbeiten</button>
                    <button type="button" className="be-icon-btn spell-dict-del" title="Entfernen">×</button>
                  </span>
                </li>
              </ul>
            </section>
            <section className="spell-dict-section">
              <h3 className="spell-dict-section-title">Ignorierte Hinweise</h3>
              <p className="spell-dict-section-hint">Einzelne Grammatik-/Stilhinweise, die unterdrückt werden (per Fingerprint).</p>
              <ul className="spell-dict-list">
                <li className="spell-dict-row">
                  <span className="spell-dict-fp">
                    <span className="spell-dict-word">voulez vous</span>
                    <code className="spell-dict-rule" title="Grammatik-/Stilregel von LanguageTool (PRONOMS_PERSONNELS_MINUSCULE): wird ausgelöst, wenn ein bestimmtes sprachliches Muster erkannt wird.">PRONOMS_PERSONNELS_MINUSCULE</code>
                  </span>
                  <span className="spell-dict-row-actions">
                    <button type="button" className="be-icon-btn spell-dict-del" title="Entfernen">×</button>
                  </span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </Section>

      <Section title="Messages">
        <div className="message success" style={{ marginTop: 0 }}>Erfolgreich gespeichert!</div>
        <div className="message error">Fehler beim Speichern.</div>
      </Section>

      <Section title="Gamemaster QR modal (Antworten tab → QR-Code)">
        <div className="qr-modal-box" style={{ position: 'relative' }}>
          <button className="qr-modal-close" aria-label="Schließen">×</button>
          <h3 className="qr-modal-title">Gamemaster auf anderem Gerät öffnen</h3>
          <p className="qr-modal-hint">
            QR-Code mit dem Handy scannen, um die Gamemaster-Ansicht direkt zu öffnen.
            Das Gerät muss im selben WLAN sein.
          </p>
          <div className="qr-code-frame">
            <QRCodeSVG value="http://192.168.0.42:3000/gamemaster/" size={240} marginSize={2} />
          </div>
          <div className="qr-ip-pills" role="group">
            <button className="qr-ip-pill is-active">en0 — 192.168.0.42</button>
            <button className="qr-ip-pill">en1 — 10.0.0.7</button>
          </div>
          <div className="qr-modal-url-row">
            <code className="qr-modal-url">http://192.168.0.42:3000/gamemaster/</code>
            <button className="answers-tab-fullscreen qr-modal-copy">Kopieren</button>
          </div>
        </div>
      </Section>

      <Section title="YouTube-Suche (DAM → YouTube → „Suchen“-Tab)">
        <div className="yt-modal-tabs" style={{ maxWidth: 320, marginBottom: 12 }}>
          <button type="button" className="yt-modal-tab is-active">🔍 Suchen</button>
          <button type="button" className="yt-modal-tab">🔗 URL</button>
        </div>
        <div className="replace-candidate-grid yt-candidate-grid">
          {[
            { title: 'Never Gonna Give You Up — Official Video', channel: 'Rick Astley', dur: '3:33', views: '1,6 Mrd', sel: true, bg: 'linear-gradient(135deg, #8b5cf6, #ec4899)' },
            { title: 'Bohemian Rhapsody (Live Aid 1985)', channel: 'Queen Official', dur: '5:59', views: '412 Mio', sel: false, bg: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
            { title: 'A very long video title that should clamp to two lines in the card layout', channel: 'Some Channel', dur: '12:04', views: '12 Tsd', sel: false, bg: 'linear-gradient(135deg, #06b6d4, #3b82f6)' },
          ].map((v, i) => (
            <button key={i} type="button" className={`yt-candidate${v.sel ? ' is-selected' : ''}`}>
              <span className="yt-candidate-thumb">
                <span style={{ position: 'absolute', inset: 0, background: v.bg }} />
                <span className="yt-candidate-views">{v.views}</span>
                <span className="yt-candidate-duration">{v.dur}</span>
              </span>
              <span className="yt-candidate-title">{v.title}</span>
              <span className="yt-candidate-channel">{v.channel}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Progress overlays (minimized)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <div className="upload-progress-minimized" style={{ pointerEvents: 'none' }}>
            <div className="upload-progress-minimized-row">
              <span className="upload-progress-minimized-label">YouTube Playlist: Demo Songs</span>
              <span className="upload-progress-minimized-detail">4 / 12</span>
            </div>
            <div className="upload-progress-track">
              <div className="upload-progress-fill" style={{ width: '33%' }} />
            </div>
          </div>
          <div className="upload-progress-minimized" style={{ pointerEvents: 'none' }}>
            <div className="upload-progress-minimized-row">
              <span className="upload-progress-minimized-label">Upload: song-42.mp3</span>
              <span className="upload-progress-minimized-detail">12 / 12</span>
            </div>
            <div className="upload-progress-track">
              <div className="upload-progress-fill upload-progress-done" style={{ width: '100%' }} />
            </div>
          </div>
          <div className="upload-progress-minimized" style={{ pointerEvents: 'none' }}>
            <div className="upload-progress-minimized-row">
              <span className="upload-progress-minimized-label">Audio Covers</span>
              <span className="upload-progress-minimized-detail">✕</span>
            </div>
            <div className="upload-progress-track">
              <div className="upload-progress-fill upload-progress-error" style={{ width: '60%' }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'rgba(var(--text-rgb), max(0.55, var(--text-fade-floor, 0)))' }}>Minimize button:</span>
            <button type="button" className="upload-progress-minimize-btn">▬</button>
          </div>
        </div>
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
          <p style={{ color: 'rgba(var(--text-rgb), max(0.55, var(--text-fade-floor, 0)))', fontSize: 14 }}>Secondary — 55% opacity</p>
          <p style={{ color: 'rgba(var(--text-rgb), max(0.35, var(--text-fade-floor, 0)))', fontSize: 14 }}>Tertiary — 35% opacity</p>
        </div>
      </Section>

      <Section title="Navigation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200, background: 'var(--admin-sidebar-bg)', borderRadius: 6, padding: '8px 0' }}>
          <button className="admin-nav-item active" style={{ width: '100%' }}>
            <span className="admin-nav-icon"><NavIcon name="config" /></span>
            <span>Config</span>
          </button>
          <button className="admin-nav-item" style={{ width: '100%' }}>
            <span className="admin-nav-icon"><NavIcon name="gameshows" /></span>
            <span>Gameshows</span>
          </button>
          <button className="admin-nav-item" style={{ width: '100%' }}>
            <span className="admin-nav-icon"><NavIcon name="games" /></span>
            <span>Spiele</span>
          </button>
          <button className="admin-nav-item" style={{ width: '100%' }}>
            <span className="admin-nav-icon"><NavIcon name="assets" /></span>
            <span>Assets</span>
          </button>
        </div>
      </Section>

      <Section title="Assets / Folders">
        <div className="backend-card" style={{ padding: 8 }}>
          <div className="asset-folder" style={{ marginBottom: 6 }}>
            <div className="asset-folder-header">
              <span className="asset-folder-chevron open">▶</span>
              <span className="asset-folder-name">Themes</span>
              <span className="asset-folder-count" style={{ flex: 1 }}>3 Ordner</span>
            </div>
          </div>
          <div className="asset-folder">
            <div className="asset-folder-header asset-folder-header--selected">
              <span className="asset-folder-chevron">▶</span>
              <span className="asset-folder-name">Retro</span>
              <span className="asset-folder-count" style={{ flex: 1 }}>12 Dateien · ausgewählt</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Video Reference Badges">
        <div className="backend-card" style={{ padding: 8 }}>
          <div className="asset-file-item" style={{ marginBottom: 6 }}>
            <span className="asset-file-icon">🎬</span>
            <span className="asset-file-name">Matrix.mp4</span>
            <span className="asset-ref-badge asset-ref-badge--online" title="Referenz → /Volumes/NAS/Movies/Matrix.mp4">🔗 Ref</span>
          </div>
          <div className="asset-file-item asset-file-item--offline">
            <span className="asset-file-icon">🎬</span>
            <span className="asset-file-name">Inception.mkv</span>
            <span className="asset-ref-badge asset-ref-badge--offline" title="Quelle nicht erreichbar">⚠ Offline</span>
          </div>
        </div>
      </Section>

      <Section title="Video-Guess Lock">
        <div className="backend-card">
          <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="be-icon-btn"
              style={{ background: 'rgba(251, 146, 60, 0.2)', border: '1px solid rgba(251, 146, 60, 0.55)', color: 'var(--warning, #fb923c)', fontWeight: 600 }}
            >
              🔒 Gesperrt
            </button>
            <span style={{ fontSize: 11, color: 'var(--warning, rgba(251, 146, 60, 0.9))' }}>Cache wird bei Saves nicht mehr verworfen.</span>
          </div>
          <div style={{ padding: '10px 12px', background: 'rgba(251, 146, 60, 0.12)', borderLeft: '4px solid rgba(251, 146, 60, 0.85)', borderRadius: 4, fontSize: 13 }}>
            Diese Instanz ist gesperrt. Entsperren, um zu bearbeiten.
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="be-icon-btn">🔓 Sperren</button>
          </div>
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

      <Section title="Confirm Dialog (replaces native window.confirm)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="confirm-modal-box" style={{ position: 'relative', margin: 0, animation: 'none' }}>
            <h3 className="confirm-modal-title">Frage löschen?</h3>
            <div className="confirm-modal-actions">
              <button className="be-icon-btn">Abbrechen</button>
              <button className="be-icon-btn confirm-modal-confirm-danger">Löschen</button>
            </div>
          </div>
          <div className="confirm-modal-box" style={{ position: 'relative', margin: 0, animation: 'none' }}>
            <h3 className="confirm-modal-title">⚠️ Wirklich ALLE LocalStorage-Daten löschen?</h3>
            <p className="confirm-modal-description">Dieser Vorgang kann nicht rückgängig gemacht werden!</p>
            <div className="confirm-modal-actions">
              <button className="be-icon-btn">Abbrechen</button>
              <button className="be-icon-btn confirm-modal-confirm-danger">Löschen</button>
            </div>
          </div>
          <div className="confirm-modal-box" style={{ position: 'relative', margin: 0, animation: 'none' }}>
            <h3 className="confirm-modal-title">Regel entfernen?</h3>
            <div className="confirm-modal-actions">
              <button className="be-icon-btn">Abbrechen</button>
              <button className="be-icon-btn folder-prompt-confirm">Entfernen</button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Planung — Overlap-Badges (abgeleitet aus Gameshow-Zugehörigkeit)">
        <div className="backend-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className="overlap-badge overlap-fresh" title="Noch nie in einer früheren Gameshow gespielt">Neu</span>
          <span className="overlap-badge overlap-none" title="Früher gespielt, aber mit anderen Spielern">Ungespielt</span>
          <span className="overlap-badge overlap-planned" title="In einer folgenden Gameshow mit gemeinsamen Spielern eingeplant">Eingeplant</span>
          <span className="overlap-badge overlap-partial" title="Manche der aktuellen Spieler kennen das Spiel schon">Teilweise</span>
          <span className="overlap-badge overlap-full" title="Alle aktuellen Spieler kennen das Spiel bereits">Gespielt</span>
        </div>
        <div className="backend-card" style={{ marginTop: 8 }}>
          <div className="planning-row">
            <div className="planning-row-main">
              <span className="overlap-badge overlap-planned">Eingeplant</span>
              <span className="planning-title">Musik der 90er</span>
              <span className="planning-instance">v1</span>
              <button className="be-icon-btn planning-add-btn">+</button>
            </div>
            <div className="planning-sessions">
              <span className="planning-session planned">
                <span className="planning-session-label">Eingeplant · Pub Quiz Juni</span>: <span className="session-player matched">Ju</span>
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Instanz: „Bereits gespielt von“ (im Spiel-Editor, schreibgeschützt)">
        <div className="backend-card">
          <div className="instance-usage">
            <div className="instance-usage-row">
              <span className="instance-usage-label">Bereits gespielt</span>
              <span className="instance-usage-show">Gameshow 3: Anita, Konsti, Lisa, Thomas</span>
            </div>
            <div className="instance-usage-row">
              <span className="instance-usage-label planned">Eingeplant</span>
              <span className="instance-usage-show planned">Vivid Gameshow 1: Steffi, Denise</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Spieler-Statistik (Klick auf Spieler-Chip in Gameshows-Tab)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="player-stats-box" style={{ position: 'relative', margin: 0, animation: 'none' }}>
            <div className="player-stats-header">
              <h3 className="player-stats-name">Ju</h3>
              <button className="be-icon-btn" aria-label="Schließen">✕</button>
            </div>
            <p className="player-stats-summary">4 gespielte Spiele in 3 verschiedenen Spielen · 2 Gameshows · 1 eingeplant</p>
            <div className="player-stats-breakdown">
              <button type="button" className="player-stats-type-row is-active">
                <span className="player-stats-type-label">Klassisches Quiz</span>
                <span className="player-stats-type-bar"><span className="player-stats-type-fill" style={{ width: '100%' }} /></span>
                <span className="player-stats-type-count">2</span>
              </button>
              <button type="button" className="player-stats-type-row">
                <span className="player-stats-type-label">Musikraten</span>
                <span className="player-stats-type-bar"><span className="player-stats-type-fill" style={{ width: '50%' }} /></span>
                <span className="player-stats-type-count">1</span>
              </button>
              <button type="button" className="player-stats-type-row">
                <span className="player-stats-type-label">Bandle</span>
                <span className="player-stats-type-bar"><span className="player-stats-type-fill" style={{ width: '50%' }} /></span>
                <span className="player-stats-type-count">1</span>
              </button>
            </div>
            <div className="player-stats-groups">
              <div className="player-stats-group">
                <div className="player-stats-group-header">
                  <button type="button" className="player-stats-group-toggle"><span className="player-stats-group-chevron open" aria-hidden="true">▶</span></button>
                  <button type="button" className="player-stats-group-title is-link">Pub Quiz Mai</button>
                  <span className="player-stats-group-count">2</span>
                </div>
                <div className="player-stats-list">
                  <div className="player-stats-entry">
                    <button type="button" className="player-stats-entry-main is-link">
                      <span className="planning-title">Allgemeinwissen</span>
                      <span className="planning-instance">v2</span>
                      <span className="player-stats-entry-type">Klassisches Quiz</span>
                    </button>
                  </div>
                  <div className="player-stats-entry">
                    <button type="button" className="player-stats-entry-main is-link">
                      <span className="planning-title">Musik der 90er</span>
                      <span className="planning-instance">v1</span>
                      <span className="player-stats-entry-type">Musikraten</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="player-stats-group is-planned">
                <div className="player-stats-group-header">
                  <button type="button" className="player-stats-group-toggle"><span className="player-stats-group-chevron" aria-hidden="true">▶</span></button>
                  <button type="button" className="player-stats-group-title is-link">Pub Quiz Juni</button>
                  <span className="overlap-badge overlap-planned">Eingeplant</span>
                  <span className="player-stats-group-count">1</span>
                </div>
                {/* collapsed — list hidden */}
              </div>
            </div>
          </div>
          <div className="player-stats-box" style={{ position: 'relative', margin: 0, animation: 'none' }}>
            <div className="player-stats-header">
              <h3 className="player-stats-name">Neuer Spieler</h3>
              <button className="be-icon-btn" aria-label="Schließen">✕</button>
            </div>
            <p className="player-stats-empty">Noch keine Gameshow mit Neuer Spieler.</p>
          </div>
        </div>
      </Section>

      <Section title="Delete Confirmation">
        <div className="modal-box delete-confirm-box" style={{ position: 'relative', margin: 0 }}>
          <h3 className="delete-confirm-title">Löschen bestätigen</h3>
          <p className="delete-confirm-subtitle">
            Folgende Elemente werden gelöscht <span className="delete-confirm-total">(47 Dateien · 1.2 GB)</span>:
          </p>
          <ul className="delete-confirm-list">
            <li className="delete-confirm-item delete-confirm-folder">
              <div className="delete-confirm-item-row">
                <span className="delete-confirm-icon" aria-hidden>📁</span>
                <span className="delete-confirm-name">Linkin Park/</span>
                <span className="delete-confirm-meta">42 Dateien · 3 Unterordner · 1.1 GB</span>
              </div>
              <div className="delete-confirm-sample">→ in-the-end.mp3, numb.mp3, crawling.mp3, … (+39)</div>
            </li>
            <li className="delete-confirm-item delete-confirm-file">
              <div className="delete-confirm-item-row">
                <span className="delete-confirm-icon" aria-hidden>🎵</span>
                <span className="delete-confirm-name">bohemian-rhapsody.mp3</span>
                <span className="delete-confirm-meta">6.4 MB</span>
              </div>
              <div className="delete-confirm-usage">⚠ Wird in 2 Spielen verwendet</div>
            </li>
            <li className="delete-confirm-item delete-confirm-file">
              <div className="delete-confirm-item-row">
                <span className="delete-confirm-icon" aria-hidden>🖼</span>
                <span className="delete-confirm-name">cover.jpg</span>
                <span className="delete-confirm-meta">180 kB</span>
              </div>
            </li>
          </ul>
          <div className="delete-confirm-note delete-confirm-note-muted">
            ℹ Dateien innerhalb von Ordnern werden nicht auf Spiel-Verwendung geprüft.
          </div>
          <label className="delete-confirm-ack">
            <input type="checkbox" readOnly />
            <span>Ich weiß, dass die betroffenen Spiele dadurch kaputtgehen können.</span>
          </label>
          <div className="delete-confirm-actions">
            <button className="be-icon-btn">Abbrechen</button>
            <button className="be-icon-btn delete-confirm-submit" disabled>Löschen</button>
          </div>
        </div>
      </Section>

      <Section title="Toast with Undo Action">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <div className="be-toast be-toast-success" style={{ position: 'static', animation: 'none' }}>
            <span className="be-toast-text">🗑️ &bdquo;3 Dateien + 1 Ordner&ldquo; gelöscht</span>
            <button className="be-toast-action">Rückgängig</button>
          </div>
          <div className="be-toast be-toast-error" style={{ position: 'static', animation: 'none' }}>
            <span className="be-toast-text">❌ 1 Fehler: file.mp3: File not found</span>
            <button className="be-toast-action">Rückgängig</button>
          </div>
        </div>
      </Section>

      <Section title="Conflict Banner (Cross-Tab Live Sync)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ConflictBanner what="Dieses Spiel" onReload={() => {}} onDismiss={() => {}} />
          <ConflictBanner what="Die Konfiguration" onReload={() => {}} onDismiss={() => {}} />
        </div>
      </Section>

      <Section title="Replace Image — AI Upscale Tab">
        <div className="replace-modal" style={{ position: 'relative', margin: 0, width: '100%', maxWidth: '100%' }}>
          <div className="replace-modal-header">
            <span className="replace-modal-title">Bild ersetzen</span>
            <span className="replace-modal-subtitle">matthew-mercer.jpg · 480 × 360px · 42 KB</span>
            <button className="be-icon-btn" aria-label="Schließen">✕</button>
          </div>
          <div className="replace-modal-tabs" role="tablist">
            <button role="tab" className="replace-modal-tab">Suchen</button>
            <button role="tab" className="replace-modal-tab">URL einfügen</button>
            <button role="tab" className="replace-modal-tab">Datei / Einfügen</button>
            <button role="tab" aria-selected className="replace-modal-tab is-active">AI hochskalieren</button>
          </div>
          <div className="replace-modal-body">
            <div className="replace-ai">
              <div className="replace-warning">
                Text und Logos können durch AI-Upscaling verschlechtert werden. Vorschau prüfen.
              </div>
              <div className="replace-ai-controls">
                <label className="replace-ai-field">
                  Modell
                  <select defaultValue="ultramix_balanced">
                    <option value="ultramix_balanced">Ultramix Balanced — Fotos, Personen, gemischt (empfohlen)</option>
                    <option value="ultrasharp">Ultrasharp — sehr scharf, schlecht bei Text & Logos</option>
                    <option value="digital_art">Digital Art — Illustrationen, Cover, Comics</option>
                  </select>
                </label>
                <label className="replace-ai-field">
                  Skalierung
                  <select defaultValue="auto">
                    <option value="auto">Auto — optimal für alle Spiele (empfohlen)</option>
                    <option value={1.5}>1,5×</option>
                    <option value={2}>2×</option>
                    <option value={3}>3×</option>
                    <option value={4}>4× — volle AI-Auflösung</option>
                  </select>
                </label>
              </div>
              <div className="replace-ai-prediction">
                Aktuell: 480×360px → vorhergesagt: 1920×1440px (4×)
              </div>
              <button type="button" className="be-btn-primary" disabled>Wird hochskaliert…</button>
              <div className="replace-ai-progress">
                <progress className="replace-ai-progress-bar" value={42} max={100} />
                <span className="replace-ai-progress-pct">42%</span>
              </div>
              <div className="replace-paste-hint">AI-Upscaling läuft lokal und dauert 3-8 Sek.</div>
            </div>
          </div>
          <div className="replace-modal-actions">
            <button className="be-btn-secondary">Abbrechen</button>
            <button className="be-btn-primary" disabled>✓ Ersetzen</button>
          </div>
        </div>
      </Section>

      <Section title="Asset Merge (Deduplication)">
        <div className="modal-box asset-merge-modal" style={{ position: 'relative', margin: 0, width: '100%', maxWidth: '100%' }}>
          <h2>Assets zusammenführen</h2>
          <p className="asset-merge-intro">
            Wähle, welche Datei erhalten bleiben soll. Die andere wird gelöscht und alle
            Spiel-Referenzen werden auf die erhaltene Datei umgeschrieben.
          </p>
          <div className="asset-merge-panes">
            <div className="asset-merge-pane asset-merge-pane--keep">
              <div className="asset-merge-pane-label">✓ Behalten</div>
              <div className="asset-merge-pane-preview" style={{ background: 'rgba(99,102,241,0.2)', minHeight: 120 }} />
              <div className="asset-merge-pane-meta">
                <div className="asset-merge-pane-name">in-the-end.jpg</div>
                <div className="asset-merge-pane-stats">142 KB · 600 × 600px · 18.04.2026</div>
                <div className="asset-merge-pane-usage">
                  <div>Verwendet in 3 Spielen:</div>
                  <div className="asset-merge-pane-usage-tags">
                    <span className="asset-usage-tag">Bandle · v1</span>
                    <span className="asset-usage-tag">Audio Guess</span>
                    <span className="asset-usage-tag">Songtexte vervollständigen</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="asset-merge-pane">
              <div className="asset-merge-pane-label">Verwerfen</div>
              <div className="asset-merge-pane-preview" style={{ background: 'rgba(99,102,241,0.12)', minHeight: 120 }} />
              <div className="asset-merge-pane-meta">
                <div className="asset-merge-pane-name">in-the-end-linkin-park.jpg</div>
                <div className="asset-merge-pane-stats">98 KB · 512 × 512px · 02.03.2026</div>
                <div className="asset-merge-pane-usage">
                  <div>Verwendet in 1 Spiel:</div>
                  <div className="asset-merge-pane-usage-tags">
                    <span className="asset-usage-tag">Image Guess · v2</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="asset-merge-summary">
            <strong>Behalten:</strong> <code>in-the-end.jpg</code><br />
            <strong>Löschen:</strong> <code>in-the-end-linkin-park.jpg</code>
          </div>
          <div className="yt-modal-actions">
            <button className="be-btn-primary">Zusammenführen</button>
            <button className="be-btn-secondary">Abbrechen</button>
          </div>
        </div>
      </Section>

      <Section title="Zufallsbild — Offline-Standbilder">
        <div className="random-frame-prerender-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.05)' }}>
          <button type="button" className="be-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Bilder herunterladen
          </button>
          <div style={{ flex: 1, minWidth: 120, height: 8, borderRadius: 4, background: 'rgba(var(--glass-rgb), 0.15)', overflow: 'hidden' }}>
            <div style={{ width: '60%', height: '100%', background: 'rgba(34,197,94,0.7)' }} />
          </div>
          <span style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.6)' }}>2/5 Fragen vorbereitet</span>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, alignItems: 'center' }}>
          <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.1)', fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(34,197,94,0.9)', cursor: 'pointer' }}>✓ 3 Bilder</button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), 0.45)' }}>— keine Offline-Bilder</span>
        </div>
        {/* Preview/select modal (click a ✓ badge) — pick which downloaded frame shows first; reload individual frames. */}
        <div className="modal-box" style={{ position: 'relative', margin: '14px 0 0', width: '100%', maxWidth: 'min(1100px, 94vw)', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--admin-sz-18, 18px)' }}>Heruntergeladene Bilder</h2>
            <button className="be-icon-btn" aria-label="Schließen">✕</button>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.65)' }}>Das mit „✓ Zuerst" markierte Bild wird offline zuerst gezeigt. Auf ein anderes klicken, um es zu markieren.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 16 }}>
            {[0, 1, 2].map(v => (
              <div key={v} style={{ border: `2px solid ${v === 1 ? 'rgba(34,197,94,0.7)' : 'rgba(var(--glass-rgb), 0.15)'}`, borderRadius: 10, overflow: 'hidden', background: 'rgba(var(--glass-rgb), 0.05)' }}>
                <div style={{ width: '100%', aspectRatio: '16 / 9', background: `rgba(99,102,241,${0.25 - v * 0.05})` }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px' }}>
                  <span style={{ fontSize: 'var(--admin-sz-13, 13px)', fontWeight: v === 1 ? 600 : 400, color: v === 1 ? 'rgba(34,197,94,0.95)' : 'rgba(var(--text-rgb), 0.55)' }}>{v === 1 ? '✓ Zuerst' : `Variante ${v + 1}`}</span>
                  <button className="be-btn-secondary" style={{ padding: '3px 10px', fontSize: 'var(--admin-sz-12, 12px)' }}>↻ Neu laden</button>
                </div>
              </div>
            ))}
          </div>
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
          <a href="/admin#config" style={{ color: '#93c5fd', textDecoration: 'none', fontSize: 14, justifySelf: 'start' }}>← Zurück zum Admin</a>
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
            <h2 style={{ fontSize: '0.7em', fontWeight: 700, marginBottom: 10, color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Frontend / Gameshow</h2>
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
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Admin / Backend</h2>
            <ThemeRow value={previewAdminTheme} onChange={setPreviewAdminTheme} themes={ADMIN_THEMES} />
          </div>
          <AdminShowcase />
        </div>
      </div>
    </div>
  );
}
