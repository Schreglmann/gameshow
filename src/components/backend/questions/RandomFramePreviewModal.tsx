import { useState, useEffect, useCallback } from 'react';
import { selectRandomFramePrerendered, reloadRandomFramePrerendered, getRandomFrameSourceReachable } from '@/services/backendApi';

interface Props {
  /** Video rel-path (no leading /videos/). */
  path: string;
  /** Question's original index. */
  index: number;
  /** Number of downloaded variants. */
  count: number;
  /** Index of the variant currently marked shown-first. */
  initialFirst: number;
  frameStart?: number;
  frameEnd?: number;
  onClose: () => void;
}

/**
 * Preview the downloaded fallback frames for one Zufallsbild question. Frames are shown in their
 * stable order; the one marked "✓ Zuerst" is shown first offline. Clicking another frame just
 * moves the marker (no reordering / re-download). Each frame can be individually re-extracted from
 * the source ("Neu laden") when the source video is reachable.
 */
export default function RandomFramePreviewModal({ path, index, count, initialFirst, frameStart, frameEnd, onClose }: Props) {
  const [first, setFirst] = useState(initialFirst);
  // Per-slot cache-bust counters — only the reloaded image needs to re-fetch.
  const [nonces, setNonces] = useState<number[]>(() => Array.from({ length: count }, () => 1));
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRandomFrameSourceReachable(path).then(setReachable).catch(() => setReachable(false));
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Address the raw downloaded file at `slot` (stable order), bypassing the first marker.
  const slotUrl = useCallback((slot: number) => {
    const params = new URLSearchParams({ path, qindex: String(index), prerendered: '1', slot: String(slot), _: String(nonces[slot] ?? 1) });
    return `/api/random-frame?${params.toString()}`;
  }, [path, index, nonces]);

  const select = useCallback(async (slot: number) => {
    if (busy || slot === first) return;
    const prev = first;
    setFirst(slot); // optimistic — order is unchanged, only the marker moves
    setError(null);
    setBusy(true);
    try {
      await selectRandomFramePrerendered(path, index, slot);
    } catch (e) {
      setFirst(prev);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, first, path, index]);

  const reload = useCallback(async (slot: number) => {
    if (busy || !reachable) return;
    setBusy(true);
    setError(null);
    try {
      await reloadRandomFramePrerendered(path, index, slot, frameStart, frameEnd);
      setNonces(ns => ns.map((n, i) => (i === slot ? n + 1 : n)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, reachable, path, index, frameStart, frameEnd]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(12px, 3vw, 32px)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="modal-box"
        style={{ position: 'relative', margin: 0, width: '100%', maxWidth: 'min(1100px, 94vw)', maxHeight: '92vh', overflowY: 'auto', borderRadius: 12, padding: 'clamp(16px, 3vw, 24px)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--admin-sz-18, 18px)' }}>Heruntergeladene Bilder</h2>
          <button className="be-icon-btn" onClick={onClose} aria-label="Schließen" style={{ flex: '0 0 auto' }}>✕</button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.65)' }}>
          Das mit „✓ Zuerst" markierte Bild wird offline zuerst gezeigt. Auf ein anderes klicken, um es zu markieren.
          {reachable === false && ' Quelle nicht erreichbar – „Neu laden" ist deaktiviert.'}
        </p>
        {error && <div style={{ marginBottom: 12, color: 'rgba(239,68,68,0.9)', fontSize: 'var(--admin-sz-13, 13px)' }}>❌ {error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 16 }}>
          {Array.from({ length: count }, (_, slot) => {
            const isFirst = slot === first;
            return (
              <div key={slot} style={{ border: `2px solid ${isFirst ? 'rgba(34,197,94,0.7)' : 'rgba(var(--glass-rgb), 0.15)'}`, borderRadius: 10, overflow: 'hidden', background: 'rgba(var(--glass-rgb), 0.05)' }}>
                <button
                  onClick={() => select(slot)}
                  disabled={busy || isFirst}
                  title={isFirst ? 'Wird zuerst gezeigt' : 'Als erstes anzeigen'}
                  style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: isFirst || busy ? 'default' : 'pointer' }}
                >
                  <img src={slotUrl(slot)} alt={`Variante ${slot + 1}`} style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', opacity: busy ? 0.6 : 1, transition: 'opacity 0.2s ease' }} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px' }}>
                  <span style={{ fontSize: 'var(--admin-sz-13, 13px)', fontWeight: isFirst ? 600 : 400, color: isFirst ? 'rgba(34,197,94,0.95)' : 'rgba(var(--text-rgb), 0.55)' }}>
                    {isFirst ? '✓ Zuerst' : `Variante ${slot + 1}`}
                  </span>
                  <button
                    onClick={() => reload(slot)}
                    disabled={busy || !reachable}
                    title={reachable ? 'Neues Bild aus dem Video laden' : 'Quelle nicht erreichbar'}
                    className="be-btn-secondary"
                    style={{ padding: '3px 10px', fontSize: 'var(--admin-sz-12, 12px)' }}
                  >↻ Neu laden</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
