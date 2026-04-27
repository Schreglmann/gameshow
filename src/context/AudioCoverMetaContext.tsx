import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchAudioCoverMeta, type AudioCoverMetaMap } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';

/**
 * Audio-cover cache-bust context. Audio covers can be overridden in place —
 * the path stays the same, the bytes change — so every `<img>` that renders
 * a cover must append a version query string tied to the cover's last-write
 * time, or the browser will keep serving the previous bytes from cache until
 * the entry's TTL expires.
 *
 * This provider fetches the provenance sidecar once, refreshes on every
 * `assets-changed:images` WebSocket event, and exposes:
 *
 *   - `coverUrl(src)` — returns `src` unchanged if it isn't an Audio-Covers
 *     path; otherwise appends `?v={setAt}` (or `?v={mountedAt}` as a fallback
 *     when no meta entry exists, so components that mount after a cover swap
 *     still cache-bust).
 *
 *   - `setCoverMeta(basename, entry)` — used by the DAM to apply optimistic
 *     updates locally so the URL bumps the instant a change is made, without
 *     waiting for the WS refresh.
 */

interface AudioCoverMetaContextValue {
  meta: AudioCoverMetaMap;
  coverUrl: (src: string | undefined) => string | undefined;
  setCoverMetaEntry: (coverFilename: string, setAt: number) => void;
}

const AudioCoverMetaContext = createContext<AudioCoverMetaContextValue | null>(null);

const AUDIO_COVERS_PREFIX = '/images/Audio-Covers/';

function parseCoverFilename(src: string): string | null {
  const [pathPart] = src.split('?', 1);
  if (!pathPart.startsWith(AUDIO_COVERS_PREFIX)) return null;
  const rel = pathPart.slice(AUDIO_COVERS_PREFIX.length);
  if (!rel || rel.includes('/')) return null;
  try { return decodeURIComponent(rel); } catch { return rel; }
}

export function AudioCoverMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<AudioCoverMetaMap>({});
  // Fallback cache-bust applied when we have no meta entry for a cover. Bumped
  // on every `assets-changed:images` WS event so a cover that was just swapped
  // but hasn't made it into the meta map yet still gets a fresh URL.
  const [fallbackVersion, setFallbackVersion] = useState<number>(() => Date.now());
  const fetchIdRef = useRef(0);

  const refresh = () => {
    const id = ++fetchIdRef.current;
    fetchAudioCoverMeta()
      .then(next => { if (id === fetchIdRef.current) setMeta(next); })
      .catch(() => { /* non-fatal */ });
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useWsChannel<{ category: string }>('assets-changed', data => {
    if (data.category !== 'images') return;
    setFallbackVersion(Date.now());
    refresh();
  });

  const value = useMemo<AudioCoverMetaContextValue>(() => ({
    meta,
    coverUrl: (src) => {
      if (!src) return src;
      const basename = parseCoverFilename(src);
      if (!basename) return src;
      const v = meta[basename]?.setAt ?? fallbackVersion;
      return src.includes('?') ? `${src}&v=${v}` : `${src}?v=${v}`;
    },
    setCoverMetaEntry: (coverFilename, setAt) => {
      setMeta(prev => {
        const existing = prev[coverFilename];
        return {
          ...prev,
          [coverFilename]: existing ? { ...existing, setAt } : { source: 'manual', setAt },
        };
      });
    },
  }), [meta, fallbackVersion]);

  return <AudioCoverMetaContext.Provider value={value}>{children}</AudioCoverMetaContext.Provider>;
}

/** Returns a coverUrl helper. Safe to call outside the provider — falls back to identity. */
export function useCoverUrl(): (src: string | undefined) => string | undefined {
  const ctx = useContext(AudioCoverMetaContext);
  return ctx ? ctx.coverUrl : (src => src);
}

export function useAudioCoverMeta(): AudioCoverMetaContextValue | null {
  return useContext(AudioCoverMetaContext);
}
