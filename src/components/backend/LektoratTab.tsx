/**
 * Lektorat tab — whole-show spelling + grammar check + the global master switch
 * + dictionary management. The feature is off by default; when off this tab shows
 * only the switch. See specs/spellcheck.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchGames,
  fetchGame,
  fetchConfig,
  fetchSpellHealth,
  fetchSpellRateStatus,
  fetchLtDockerStatus,
  startLtDocker,
  stopLtDocker,
  cancelLtDocker,
  checkSpelling,
  saveGame,
  ApiError,
  type SpellRateStatus,
  type LanguageToolDockerStatus,
} from '@/services/backendApi';
import { segmentsForGameFile, applyReplacement, type SpellSegment } from '@/utils/spellcheckFields';
import { useSpellcheckSettings } from './SpellcheckSettingsContext';
import SpellCheckPanel, { type SpellGroup, type SpellIssue } from './SpellCheckPanel';
import SpellcheckDictionary from './SpellcheckDictionary';

interface Props {
  onNavigateToGame: (fileName: string, instance?: string, questionIndex?: number) => void;
}

interface IssueMeta {
  fileName: string;
  gameTitle: string;
  instanceKey: string | null;
  segKey: string;
  path: (string | number)[];
}

interface PanelEntry {
  issue: SpellIssue;
  meta: IssueMeta;
}

/** Run `worker` over `items` with at most `limit` concurrent in-flight. */
async function pool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

const questionIndexFromSegKey = (segKey: string): number | undefined => {
  const m = /^q(\d+)\./.exec(segKey);
  return m ? Number(m[1]) : undefined;
};

export default function LektoratTab({ onNavigateToGame }: Props) {
  const settings = useSpellcheckSettings();
  const [health, setHealth] = useState<{ ok: boolean; url?: string; reason?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [entries, setEntries] = useState<PanelEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [rate, setRate] = useState<SpellRateStatus | null>(null);
  const [view, setView] = useState<'main' | 'dictionary'>('main');
  const [ltDocker, setLtDocker] = useState<LanguageToolDockerStatus | null>(null);

  // Cache fetched game files so Apply can splice + save without a re-fetch.
  const gameFiles = useRef<Map<string, Record<string, unknown>>>(new Map());

  // Health (which endpoint the checker actually uses): on enable, and whenever local routing flips.
  const ltActive = ltDocker?.active ?? false;
  useEffect(() => {
    if (!settings.enabled) { setHealth(null); return; }
    let cancelled = false;
    fetchSpellHealth()
      .then(h => { if (!cancelled) setHealth({ ok: h.ok, url: h.url, reason: h.reason }); })
      .catch(() => { if (!cancelled) setHealth({ ok: false, reason: 'unreachable' }); });
    return () => { cancelled = true; };
  }, [settings.enabled, ltActive]);

  // While scanning, poll the server's rate-limiter so the user sees when we're waiting on the
  // public-API rate limit (rather than the scan just appearing to stall).
  useEffect(() => {
    if (!scanning) { setRate(null); return; }
    let cancelled = false;
    const tick = () => {
      fetchSpellRateStatus().then(r => { if (!cancelled) setRate(r); }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [scanning]);

  // Poll the local-container status while the feature + main view are open. This also makes the
  // SERVER reconcile routing (getStatus routes the checker at the local container once it's healthy),
  // so a running container is actually used even if start()'s health poll had given up. Fast cadence
  // during a transient phase (snappy progress bar), slower when settled.
  const ltPhase = ltDocker?.phase;
  const ltRunningNotReady = ltDocker?.container === 'running' && ltDocker?.ready === false;
  useEffect(() => {
    if (!settings.enabled || view !== 'main') { if (!settings.enabled) setLtDocker(null); return; }
    let cancelled = false;
    const tick = () => { fetchLtDockerStatus().then(s => { if (!cancelled) setLtDocker(s); }).catch(() => {}); };
    tick();
    const transient = ltPhase === 'pulling' || ltPhase === 'starting' || ltPhase === 'stopping';
    // Poll fast while transitioning OR warming (running-but-not-ready) so the UI flips to ready promptly.
    const id = setInterval(tick, transient || ltRunningNotReady ? 1500 : 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [settings.enabled, view, ltPhase, ltRunningNotReady]);

  const handleLtStart = useCallback(async () => {
    try { setLtDocker(await startLtDocker()); } catch { /* status poll will recover */ }
  }, []);
  const handleLtStop = useCallback(async () => {
    try { setLtDocker(await stopLtDocker()); } catch { /* status poll will recover */ }
  }, []);
  const handleLtCancel = useCallback(async () => {
    try { setLtDocker(await cancelLtDocker()); } catch { /* status poll will recover */ }
  }, []);

  const runScan = useCallback(async (scope: 'all' | 'active') => {
    setScanning(true);
    setError(null);
    setEntries([]);
    gameFiles.current.clear();
    // Nudge the server to (re)establish routing at the local container if it's running + healthy,
    // so this scan uses the fast local instance rather than the rate-limited public API.
    await fetchLtDockerStatus().then(setLtDocker).catch(() => {});
    try {
      let fileNames: string[];
      if (scope === 'active') {
        const cfg = await fetchConfig();
        const order = cfg.gameshows?.[cfg.activeGameshow]?.gameOrder ?? [];
        fileNames = [...new Set(order.map(ref => ref.split('/')[0]).filter(Boolean))];
      } else {
        const games = await fetchGames();
        fileNames = games.filter(g => !g.parseError).map(g => g.fileName);
      }

      setProgress({ done: 0, total: fileNames.length });
      setHasScanned(true);

      // Phase 1 — fetch every game and collect ALL prose segments into one list, with keys
      // namespaced by file+instance so they don't collide across games. (No LanguageTool calls.)
      const SEP = '';
      const lookup = new Map<string, { fileName: string; gameTitle: string; instanceKey: string | null; seg: SpellSegment }>();
      const allSegs: { key: string; text: string }[] = [];
      let fetched = 0;
      await pool(fileNames, 6, async (fileName) => {
        try {
          const gameFile = (await fetchGame(fileName)) as Record<string, unknown>;
          gameFiles.current.set(fileName, gameFile);
          const gameTitle = (typeof gameFile.title === 'string' && gameFile.title) || fileName;
          for (const { instanceKey, segments } of segmentsForGameFile(gameFile)) {
            for (const seg of segments) {
              if (seg.text.trim().length === 0) continue;
              const nkey = `${fileName}${SEP}${instanceKey ?? ''}${SEP}${seg.key}`;
              lookup.set(nkey, { fileName, gameTitle, instanceKey, seg });
              allSegs.push({ key: nkey, text: seg.text });
            }
          }
        } catch { /* skip a game that fails to load */ }
        finally { fetched += 1; setProgress({ done: fetched, total: fileNames.length }); }
      });

      // Phase 2 — check EVERYTHING in as few requests as possible. The server batches de-DE + en-US
      // over big chunks, so the whole show is ~2 requests (local) instead of one round-trip per game.
      const collected: PanelEntry[] = [];
      const BATCH = 800; // cap segments per /check request (server cap is 2000)
      const batches: { key: string; text: string }[][] = [];
      for (let i = 0; i < allSegs.length; i += BATCH) batches.push(allSegs.slice(i, i + BATCH));
      await pool(batches, 2, async (batch) => {
        try {
          const results = await checkSpelling(batch);
          for (const r of results) {
            const info = lookup.get(r.key);
            if (!info) continue;
            const { fileName, gameTitle, instanceKey, seg } = info;
            for (const match of r.matches) {
              collected.push({
                issue: {
                  id: `${fileName}::${instanceKey ?? '_'}::${seg.key}::${match.offset}`,
                  label: instanceKey ? `${instanceKey} · ${seg.label}` : seg.label,
                  text: seg.text,
                  match,
                },
                meta: { fileName, gameTitle, instanceKey, segKey: seg.key, path: seg.path },
              });
            }
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 503) {
            setError('LanguageTool-Ratenlimit erreicht. Bitte kurz warten – oder eine eigene LanguageTool-Instanz über LANGUAGETOOL_URL anbinden.');
          } else if (err instanceof ApiError && err.status === 502) {
            setError('LanguageTool ist nicht erreichbar. Bitte Server/Verbindung prüfen.');
          } else {
            setError(err instanceof Error ? err.message : 'Prüfung fehlgeschlagen.');
          }
        }
      });

      setEntries(collected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prüfung fehlgeschlagen.');
    } finally {
      setScanning(false);
    }
  }, []);

  // ── Issue actions ──

  const handleApply = useCallback(async (issue: SpellIssue, replacement: string) => {
    const entry = entries.find(e => e.issue.id === issue.id);
    if (!entry) return;
    const { fileName, path, segKey } = entry.meta;
    const gameFile = gameFiles.current.get(fileName);
    if (!gameFile) return;
    const updated = applyReplacement(gameFile, path, issue.match.offset, issue.match.length, replacement);
    gameFiles.current.set(fileName, updated);
    try {
      await saveGame(fileName, updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
      return;
    }
    // Drop every issue on the same field — their offsets are now stale.
    setEntries(prev => prev.filter(e => !(e.meta.fileName === fileName && e.meta.segKey === segKey)));
  }, [entries]);

  const handleAllowWord = useCallback(async (issue: SpellIssue) => {
    const word = issue.text.slice(issue.match.offset, issue.match.offset + issue.match.length);
    await settings.allowWord(word);
    const norm = word.normalize('NFC').toLowerCase().trim();
    setEntries(prev => prev.filter(e => {
      const w = e.issue.text.slice(e.issue.match.offset, e.issue.match.offset + e.issue.match.length);
      return w.normalize('NFC').toLowerCase().trim() !== norm;
    }));
  }, [settings]);

  const handleIgnore = useCallback(async (issue: SpellIssue) => {
    await settings.ignoreMatch(issue.match.fingerprint);
    setEntries(prev => prev.filter(e => e.issue.match.fingerprint !== issue.match.fingerprint));
  }, [settings]);

  // ── Build groups (one per game file + instance) ──

  const groupOrder: string[] = [];
  const groupMap = new Map<string, SpellGroup>();
  for (const e of entries) {
    const gkey = `${e.meta.fileName}::${e.meta.instanceKey ?? '_'}`;
    if (!groupMap.has(gkey)) {
      groupOrder.push(gkey);
      const firstQ = questionIndexFromSegKey(e.meta.segKey);
      groupMap.set(gkey, {
        groupLabel: e.meta.instanceKey ? `${e.meta.gameTitle} · ${e.meta.instanceKey}` : e.meta.gameTitle,
        deepLink: () => onNavigateToGame(e.meta.fileName, e.meta.instanceKey ?? undefined, firstQ),
        issues: [],
      });
    }
    groupMap.get(gkey)!.issues.push(e.issue);
  }
  const groups = groupOrder.map(k => groupMap.get(k)!);

  // Lifecycle pill for the local LanguageTool container.
  const ltPill = (() => {
    if (!ltDocker) return { cls: 'lektorat-health--muted', label: '…' };
    if (!ltDocker.dockerInstalled) return { cls: 'lektorat-health--muted', label: 'Docker nicht installiert' };
    if (!ltDocker.dockerAvailable) return { cls: 'lektorat-health--muted', label: 'Docker-Daemon aus' };
    switch (ltDocker.phase) {
      case 'running': return ltDocker.ready
        ? { cls: 'lektorat-health--ok', label: 'Lokaler Server läuft' }
        : { cls: 'lektorat-health--info', label: 'Sprachmodelle werden geladen…' };
      case 'pulling': return { cls: 'lektorat-health--info', label: 'Image wird geladen…' };
      case 'starting': return { cls: 'lektorat-health--info', label: 'Wird gestartet…' };
      case 'stopping': return { cls: 'lektorat-health--info', label: 'Wird gestoppt…' };
      case 'error': return { cls: 'lektorat-health--bad', label: 'Fehler' };
      default: return { cls: 'lektorat-health--muted', label: 'Gestoppt' };
    }
  })();
  const ltTransient = ltPhase === 'pulling' || ltPhase === 'starting' || ltPhase === 'stopping';
  // The local server exists but isn't ready to scan yet (pulling / starting / stopping / warming):
  // block scanning until it's fully ready (or stopped, in which case the public API is used).
  const ltNotReady = !!ltDocker && (ltTransient || (ltDocker.container === 'running' && !ltDocker.ready));

  // Endpoint pill: which spellchecker the scan actually uses right now (local vs remote/public).
  const endpointPill = (() => {
    if (ltActive) return { cls: 'lektorat-health--ok', label: 'Prüfung: Lokaler Server' };
    if (!health) return null;
    if (!health.ok) return { cls: 'lektorat-health--bad', label: 'LanguageTool nicht erreichbar' };
    const isPublic = (health.url ?? '').includes('languagetool.org');
    return {
      cls: 'lektorat-health--info',
      label: isPublic ? 'Prüfung: Öffentliche API (Ratenlimit)' : 'Prüfung: Eigener Server',
    };
  })();

  return (
    <div className="lektorat-tab">
      <div className="lektorat-master">
        <div className="lektorat-master-text">
          <span className="lektorat-master-title">Rechtschreibprüfung</span>
          <span className="lektorat-master-sub">
            Prüft alle Fragen, Antworten und Regeln auf deutsche Rechtschreib- und Grammatikfehler.
            Standardmäßig deaktiviert.
          </span>
        </div>
        <label className="be-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={settings.loading}
            onChange={e => { void settings.setEnabled(e.target.checked); }}
          />
          <span className="be-toggle-track" />
          <span className="be-toggle-label">{settings.enabled ? 'Aktiv' : 'Aus'}</span>
        </label>
      </div>

      {!settings.enabled ? (
        <div className="lektorat-disabled-note">
          Die Rechtschreibprüfung ist deaktiviert. Aktiviere sie oben, um Spiele zu prüfen.
        </div>
      ) : view === 'dictionary' ? (
        <SpellcheckDictionary onBack={() => setView('main')} />
      ) : (
        <>
          {ltDocker && (
            <div className="lt-server">
              <div className="lt-server-head">
                <span className="lt-server-title">Lokaler LanguageTool-Server</span>
                <span className={`lektorat-health ${ltPill.cls}`}>{ltPill.label}</span>
                {ltTransient ? (
                  <button type="button" className="be-icon-btn danger" onClick={() => void handleLtCancel()}>
                    Abbrechen
                  </button>
                ) : ltDocker.active || ltDocker.phase === 'running' ? (
                  <button type="button" className="be-icon-btn danger" onClick={() => void handleLtStop()}>
                    Server stoppen
                  </button>
                ) : (
                  <button
                    type="button"
                    className="be-btn-primary"
                    disabled={!ltDocker.dockerAvailable}
                    onClick={() => void handleLtStart()}
                  >
                    Server starten
                  </button>
                )}
              </div>

              {ltDocker.phase === 'pulling' && (
                <div className="lt-server-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ltDocker.progress ?? 0}>
                  <div className="lt-server-progress-fill" style={{ width: `${ltDocker.progress ?? 0}%` }} />
                </div>
              )}
              {ltTransient && <span className="lt-server-hint">{ltDocker.message || 'Wird gestartet…'}</span>}
              {ltDocker.phase === 'error' && ltDocker.message && (
                <span className="lt-server-msg">{ltDocker.message}</span>
              )}

              <span className="lt-server-hint">
                {!ltDocker.dockerInstalled
                  ? 'Docker ist auf diesem Rechner nicht installiert – es wird die öffentliche API (Ratenlimit) genutzt.'
                  : !ltDocker.dockerAvailable
                  ? 'Docker-Daemon läuft nicht – bitte Docker (Desktop) starten. Solange wird die öffentliche API (Ratenlimit) genutzt.'
                  : 'Lokaler Server = sofortige, unbegrenzte Prüfung (kein Ratenlimit). Der erste Start lädt einmalig ein ~500 MB Docker-Image.'}
              </span>
            </div>
          )}

          <div className="lektorat-controls">
            <button
              type="button"
              className="be-btn-primary"
              disabled={scanning || ltNotReady}
              title={ltNotReady ? 'Der lokale Server ist noch nicht bereit.' : undefined}
              onClick={() => void runScan('active')}
            >
              Aktuelle Gameshow prüfen
            </button>
            <button
              type="button"
              className="be-icon-btn"
              disabled={scanning || ltNotReady}
              title={ltNotReady ? 'Der lokale Server ist noch nicht bereit.' : undefined}
              onClick={() => void runScan('all')}
            >
              Alle Spiele prüfen
            </button>
            <button type="button" className="be-icon-btn" onClick={() => setView('dictionary')}>
              Wörterbuch verwalten
              {(settings.allowedWords.length > 0 || settings.ignoredMatches.length > 0) && (
                <span className="lektorat-dict-count"> ({settings.allowedWords.length + settings.ignoredMatches.length})</span>
              )}
            </button>
            {endpointPill && (
              <span className={`lektorat-health ${endpointPill.cls}`}>{endpointPill.label}</span>
            )}
          </div>
          {ltNotReady && (
            <div className="lektorat-disabled-note" style={{ textAlign: 'left', padding: '4px 0' }}>
              Der lokale LanguageTool-Server wird vorbereitet – die Prüfung ist verfügbar, sobald er bereit ist.
            </div>
          )}

          {scanning && rate && (rate.throttling || rate.windowCount > 0) && (
            <div
              className={`lektorat-ratelimit ${rate.throttling ? 'lektorat-ratelimit--wait' : 'lektorat-ratelimit--info'}`}
              role="status"
              aria-live="polite"
            >
              <span className="lektorat-ratelimit-main">
                {rate.throttling ? (
                  <>
                    ⏳ Ratenlimit der öffentlichen LanguageTool-API erreicht – warte
                    {rate.retryAfterMs > 0 ? ` ~${Math.ceil(rate.retryAfterMs / 1000)} s` : ' …'}
                    {rate.waiting > 1 ? ` (${rate.waiting} Anfragen in der Warteschlange)` : ''}.
                  </>
                ) : (
                  <>
                    Öffentliche LanguageTool-API: {rate.windowCount}/{rate.windowMax} Anfragen in diesem Minutenfenster.
                  </>
                )}
              </span>
              <span className="lektorat-ratelimit-hint">
                Für sofortige, unbegrenzte Prüfung eine eigene LanguageTool-Instanz über LANGUAGETOOL_URL anbinden.
              </span>
            </div>
          )}

          {(scanning || hasScanned) && (
            <SpellCheckPanel
              groups={groups}
              loading={scanning}
              progress={progress}
              error={error}
              onApply={handleApply}
              onAllowWord={handleAllowWord}
              onIgnore={handleIgnore}
            />
          )}
        </>
      )}
    </div>
  );
}
