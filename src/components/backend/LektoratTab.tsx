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
  checkSpelling,
  saveGame,
  ApiError,
  type SpellRateStatus,
} from '@/services/backendApi';
import { segmentsForGameFile, applyReplacement, type SpellSegment } from '@/utils/spellcheckFields';
import { useSpellcheckSettings } from './SpellcheckSettingsContext';
import SpellCheckPanel, { type SpellGroup, type SpellIssue } from './SpellCheckPanel';

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
  const [health, setHealth] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [entries, setEntries] = useState<PanelEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [rate, setRate] = useState<SpellRateStatus | null>(null);

  // Cache fetched game files so Apply can splice + save without a re-fetch.
  const gameFiles = useRef<Map<string, Record<string, unknown>>>(new Map());

  useEffect(() => {
    if (!settings.enabled) return;
    let cancelled = false;
    fetchSpellHealth()
      .then(h => { if (!cancelled) setHealth({ ok: h.ok, reason: h.reason }); })
      .catch(() => { if (!cancelled) setHealth({ ok: false, reason: 'unreachable' }); });
    return () => { cancelled = true; };
  }, [settings.enabled]);

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

  const runScan = useCallback(async (scope: 'all' | 'active') => {
    setScanning(true);
    setError(null);
    setEntries([]);
    gameFiles.current.clear();
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
      const collected: PanelEntry[] = [];
      let done = 0;

      await pool(fileNames, 6, async (fileName) => {
        try {
          const gameFile = (await fetchGame(fileName)) as Record<string, unknown>;
          gameFiles.current.set(fileName, gameFile);
          const gameTitle = (typeof gameFile.title === 'string' && gameFile.title) || fileName;
          const perInstance = segmentsForGameFile(gameFile);
          for (const { instanceKey, segments } of perInstance) {
            const checkable = segments.filter(s => s.text.trim().length > 0);
            if (checkable.length === 0) continue;
            const results = await checkSpelling(checkable.map(s => ({ key: s.key, text: s.text })));
            const segByKey = new Map<string, SpellSegment>(checkable.map(s => [s.key, s]));
            for (const r of results) {
              const seg = segByKey.get(r.key);
              if (!seg) continue;
              for (const match of r.matches) {
                collected.push({
                  issue: {
                    id: `${fileName}::${instanceKey ?? '_'}::${r.key}::${match.offset}`,
                    label: instanceKey ? `${instanceKey} · ${seg.label}` : seg.label,
                    text: seg.text,
                    match,
                  },
                  meta: { fileName, gameTitle, instanceKey, segKey: r.key, path: seg.path },
                });
              }
            }
          }
        } catch (err) {
          // One unreachable/failed game shouldn't abort the whole scan.
          if (err instanceof ApiError && err.status === 503) {
            setError('LanguageTool-Ratenlimit erreicht. Bitte kurz warten – oder eine eigene LanguageTool-Instanz über LANGUAGETOOL_URL anbinden.');
          } else if (err instanceof ApiError && err.status === 502) {
            setError('LanguageTool ist nicht erreichbar. Bitte Server/Verbindung prüfen.');
          }
        } finally {
          done += 1;
          setProgress({ done, total: fileNames.length });
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
      ) : (
        <>
          <div className="lektorat-controls">
            <button type="button" className="be-btn-primary" disabled={scanning} onClick={() => void runScan('active')}>
              Aktuelle Gameshow prüfen
            </button>
            <button type="button" className="be-icon-btn" disabled={scanning} onClick={() => void runScan('all')}>
              Alle Spiele prüfen
            </button>
            {health && (
              <span className={`lektorat-health ${health.ok ? 'lektorat-health--ok' : 'lektorat-health--bad'}`}>
                LanguageTool {health.ok ? 'verbunden' : 'nicht erreichbar'}
              </span>
            )}
          </div>

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

          {(settings.allowedWords.length > 0 || settings.ignoredMatches.length > 0) && (
            <div className="lektorat-dict">
              <h3 className="lektorat-section-title">Wörterbuch</h3>
              {settings.allowedWords.length > 0 && (
                <div className="lektorat-dict-list">
                  {settings.allowedWords.map(w => (
                    <span className="lektorat-chip" key={w}>
                      {w}
                      <button type="button" className="lektorat-chip-x" title="Entfernen" onClick={() => void settings.removeWord(w)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {settings.ignoredMatches.length > 0 && (
                <div className="lektorat-dict-list">
                  {settings.ignoredMatches.map(fp => (
                    <span className="lektorat-chip" key={fp}>
                      <code>{fp}</code>
                      <button type="button" className="lektorat-chip-x" title="Entfernen" onClick={() => void settings.unignoreMatch(fp)}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
