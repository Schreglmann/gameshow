import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AssetCategory } from '@/types/config';
import { uploadAsset, youtubeDownload, cancelYtDownload as apiCancelYtDownload, fetchYtDownloadStatus, type YtDownloadJob } from '@/services/backendApi';

export interface UploadProgress {
  fileIndex: number;
  total: number;
  fileName: string;
  filePercent: number;
  phase: 'uploading' | 'processing';
  category: AssetCategory;
  /** Bytes per second (smoothed) */
  speed: number;
  /** Estimated seconds remaining for current file */
  eta: number;
  /** Bytes uploaded so far for current file */
  loaded: number;
  /** Total bytes for current file */
  fileSize: number;
  /** Seconds elapsed since this file's upload started */
  elapsed: number;
}

export interface YtPlaylistTrack {
  title: string;
  phase: 'resolving' | 'downloading' | 'processing' | 'done';
  percent: number;
}

export interface YtDownloadProgress {
  id: number;
  serverId?: string;
  phase: 'resolving' | 'downloading' | 'processing' | 'done' | 'error';
  percent: number;
  title: string;
  error?: string;
  // Playlist-specific
  playlistTitle?: string;
  trackIndex?: number;
  trackCount?: number;
  tracks?: YtPlaylistTrack[];
}

interface UploadContextValue {
  uploadProgress: UploadProgress | null;
  startUpload: (category: AssetCategory, files: File[], subfolder?: string) => Promise<{ success: boolean; count: number }>;
  abortUpload: () => void;
  ytDownloads: YtDownloadProgress[];
  startYtDownload: (category: AssetCategory, url: string, subfolder?: string, onDone?: () => void, playlist?: boolean) => void;
  cancelYtDownload: (id: number) => void;
  dismissYtDownload: (id: number) => void;
}

const Ctx = createContext<UploadContextValue>(null!);

export function useUpload() { return useContext(Ctx); }

let nextYtId = 1;

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [ytDownloads, setYtDownloads] = useState<YtDownloadProgress[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Server job IDs with an active SSE connection — polling skips these to avoid duplicates
  const liveJobIds = useRef(new Set<string>());

  // Speed tracking refs (not in state to avoid extra renders)
  const startTimeRef = useRef(0);
  const lastLoadedRef = useRef(0);
  const lastTimeRef = useRef(0);
  const smoothSpeedRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const displayEtaRef = useRef(0);

  const abortUpload = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startUpload = useCallback(async (category: AssetCategory, files: File[], subfolder?: string): Promise<{ success: boolean; count: number }> => {
    if (!files.length) return { success: true, count: 0 };
    const controller = new AbortController();
    abortRef.current = controller;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Reset speed tracking for each file
      const now = Date.now();
      startTimeRef.current = now;
      lastLoadedRef.current = 0;
      lastTimeRef.current = now;
      lastUiUpdateRef.current = 0;
      smoothSpeedRef.current = 0;
      displayEtaRef.current = 0;

      setUploadProgress({ fileIndex: i, total: files.length, fileName: file.name, filePercent: 0, phase: 'uploading', category, speed: 0, eta: 0, loaded: 0, fileSize: file.size, elapsed: 0 });
      try {
        await uploadAsset(
          category, file, subfolder,
          (pct, loaded, total) => {
            const now = Date.now();
            const bytesLoaded = loaded ?? 0;
            const bytesTotal = total ?? file.size;
            const elapsed = (now - startTimeRef.current) / 1000;

            // Compute instantaneous speed from delta (for display speed)
            const dt = (now - lastTimeRef.current) / 1000;
            const dBytes = bytesLoaded - lastLoadedRef.current;
            if (dt > 0.1 && dBytes > 0) {
              const instantSpeed = dBytes / dt;
              smoothSpeedRef.current = smoothSpeedRef.current > 0
                ? smoothSpeedRef.current * 0.7 + instantSpeed * 0.3
                : instantSpeed;
              lastLoadedRef.current = bytesLoaded;
              lastTimeRef.current = now;
            }

            // ETA based on overall average speed (much more stable than instantaneous)
            const avgSpeed = elapsed > 0.5 ? bytesLoaded / elapsed : 0;
            const remaining = bytesTotal - bytesLoaded;
            const rawEta = avgSpeed > 0 ? remaining / avgSpeed : 0;

            // Smooth the displayed ETA: only update once per second, and
            // move towards the new value gradually to avoid jumps
            const sinceLastUi = now - lastUiUpdateRef.current;
            if (sinceLastUi >= 1000 || lastUiUpdateRef.current === 0) {
              lastUiUpdateRef.current = now;
              if (displayEtaRef.current <= 0) {
                displayEtaRef.current = rawEta;
              } else {
                // Blend: 70% previous display value, 30% new calculation
                displayEtaRef.current = displayEtaRef.current * 0.7 + rawEta * 0.3;
              }
            }

            setUploadProgress(prev => ({
              fileIndex: i, total: files.length, fileName: file.name, filePercent: pct,
              phase: pct >= 100 ? 'processing' : (prev?.phase === 'processing' ? 'processing' : 'uploading'),
              category,
              speed: smoothSpeedRef.current,
              eta: displayEtaRef.current,
              loaded: bytesLoaded,
              fileSize: bytesTotal,
              elapsed,
            }));
          },
          phase => setUploadProgress(prev => prev ? { ...prev, phase, filePercent: 100, eta: 0 } : prev),
          controller.signal,
        );
      } catch (e) {
        setUploadProgress(null);
        abortRef.current = null;
        if ((e as Error).name === 'AbortError') return { success: false, count: i };
        throw e;
      }
    }
    setUploadProgress(null);
    abortRef.current = null;
    return { success: true, count: files.length };
  }, []);

  const startYtDownload = useCallback((category: AssetCategory, url: string, subfolder?: string, onDone?: () => void, playlist?: boolean) => {
    const id = nextYtId++;
    const entry: YtDownloadProgress = { id, phase: 'downloading', percent: 0, title: '' };
    setYtDownloads(prev => [...prev, entry]);

    youtubeDownload(category, url, subfolder, (event) => {
      // Capture jobId from server and register as live (prevents polling duplicates)
      if (event.jobId) {
        liveJobIds.current.add(event.jobId);
        setYtDownloads(prev => prev.map(d => d.id === id ? { ...d, serverId: event.jobId } : d));
        return;
      }
      setYtDownloads(prev => prev.map(d => {
        if (d.id !== id) return d;
        // Per-track events (trackIndex > 0) must not override the job-level phase,
        // because concurrent workers send interleaved events.
        const isPerTrackEvent = event.trackIndex != null && event.trackIndex > 0;
        const updated: YtDownloadProgress = {
          ...d,
          phase: isPerTrackEvent ? d.phase : (event.phase as YtDownloadProgress['phase']),
          percent: event.percent ?? d.percent,
          title: event.title ?? d.title,
          playlistTitle: event.playlistTitle ?? d.playlistTitle,
          trackIndex: event.trackIndex ?? d.trackIndex,
          trackCount: event.trackCount ?? d.trackCount,
        };

        // Accumulate per-track state for playlists — each track is independent
        // (no "mark previous as done" heuristic; workers run concurrently)
        if (event.trackIndex != null && event.trackIndex > 0) {
          const tracks = [...(d.tracks ?? [])];
          const idx = event.trackIndex - 1; // 0-based

          // Ensure array is large enough
          while (tracks.length <= idx) {
            tracks.push({ title: '', phase: 'resolving', percent: 0 });
          }

          const title = event.title || tracks[idx].title;
          if (event.phase === 'resolving') {
            tracks[idx] = { title, phase: 'resolving', percent: 0 };
          } else if (event.phase === 'downloading') {
            tracks[idx] = { title, phase: 'downloading', percent: event.percent ?? tracks[idx].percent };
          } else if (event.phase === 'processing') {
            tracks[idx] = { title, phase: 'processing', percent: 100 };
          } else if (event.phase === 'done') {
            tracks[idx] = { title, phase: 'done', percent: 100 };
          }

          updated.tracks = tracks;
        }

        return updated;
      }));
    }, playlist).then(() => {
      setYtDownloads(prev => {
        const dl = prev.find(d => d.id === id);
        if (dl?.serverId) liveJobIds.current.delete(dl.serverId);
        return prev.map(d => d.id !== id ? d : {
          ...d,
          phase: 'done',
          tracks: d.tracks?.map(t => ({ ...t, phase: 'done' as const, percent: 100 })),
        });
      });
      onDone?.();
      // Auto-dismiss after 5s for playlists (more tracks to glance at), 3s for singles
      const delay = playlist ? 5000 : 3000;
      setTimeout(() => setYtDownloads(prev => prev.filter(d => d.id !== id)), delay);
    }).catch((err) => {
      setYtDownloads(prev => {
        const dl = prev.find(d => d.id === id);
        if (dl?.serverId) liveJobIds.current.delete(dl.serverId);
        return prev.map(d => d.id !== id ? d : { ...d, phase: 'error', error: (err as Error).message });
      });
    });
  }, []);

  const cancelYtDownload = useCallback((id: number) => {
    setYtDownloads(prev => {
      const dl = prev.find(d => d.id === id);
      if (dl?.serverId) {
        apiCancelYtDownload(dl.serverId).catch(() => {});
      }
      return prev;
    });
  }, []);

  const dismissYtDownload = useCallback((id: number) => {
    setYtDownloads(prev => prev.filter(d => d.id !== id));
  }, []);

  // Poll for active server-side downloads on mount (reconnects progress after page reload)
  useEffect(() => {
    let active = true;

    const jobToEntry = (job: YtDownloadJob): YtDownloadProgress => ({
      id: -(nextYtId++),
      serverId: job.id,
      phase: job.phase,
      percent: job.percent,
      title: job.title,
      error: job.error,
      playlistTitle: job.playlistTitle,
      trackIndex: job.trackIndex,
      trackCount: job.trackCount,
      tracks: job.tracks,
    });

    const poll = async () => {
      try {
        const jobs = await fetchYtDownloadStatus();
        if (!active) return;
        // Only handle jobs not owned by an active SSE connection
        const reconnected = jobs.filter(j => !liveJobIds.current.has(j.id));
        if (reconnected.length === 0) {
          // Remove any polled entries whose server job disappeared (cleanup happened)
          setYtDownloads(prev => prev.filter(d => !d.serverId || liveJobIds.current.has(d.serverId) || jobs.some(j => j.id === d.serverId)));
          return;
        }

        setYtDownloads(prev => {
          const next = [...prev];
          for (const job of reconnected) {
            const existing = next.find(d => d.serverId === job.id);
            if (existing) {
              existing.phase = job.phase;
              existing.percent = job.percent;
              existing.title = job.title;
              existing.error = job.error;
              existing.playlistTitle = job.playlistTitle;
              existing.trackIndex = job.trackIndex;
              existing.trackCount = job.trackCount;
              existing.tracks = job.tracks;
            } else {
              next.push(jobToEntry(job));
            }
          }
          // Remove polled entries whose server job disappeared
          return next.filter(d => !d.serverId || liveJobIds.current.has(d.serverId) || jobs.some(j => j.id === d.serverId));
        });
      } catch { /* ignore network errors during poll */ }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => { active = false; clearInterval(id); };
  }, []);

  return (
    <Ctx.Provider value={{ uploadProgress, startUpload, abortUpload, ytDownloads, startYtDownload, cancelYtDownload, dismissYtDownload }}>
      {children}
    </Ctx.Provider>
  );
}
