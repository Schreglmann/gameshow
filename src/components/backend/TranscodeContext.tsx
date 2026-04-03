import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { fetchTranscodeStatus, startTranscode, type TranscodeJob } from '@/services/backendApi';

interface TranscodeContextValue {
  /** Map of filePath → job for all active/recent transcode jobs */
  jobs: Map<string, TranscodeJob>;
  /** Start a transcode for a video file (relative path) */
  startJob: (filePath: string) => Promise<void>;
}

const Ctx = createContext<TranscodeContextValue>(null!);

export function useTranscode() { return useContext(Ctx); }

export function TranscodeProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Map<string, TranscodeJob>>(new Map());

  // Poll every 2s while any job is running, otherwise every 10s (just to catch new ones on reload)
  useEffect(() => {
    let active = true;
    const poll = () => {
      fetchTranscodeStatus().then(list => {
        if (!active) return;
        const map = new Map<string, TranscodeJob>();
        list.forEach(j => map.set(j.filePath, j));
        setJobs(map);
      }).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const startJob = useCallback(async (filePath: string) => {
    await startTranscode(filePath);
    // Optimistically add a running job so UI updates immediately
    setJobs(prev => {
      const next = new Map(prev);
      next.set(filePath, { filePath, percent: 0, status: 'running', startedAt: Date.now(), elapsed: 0 });
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ jobs, startJob }}>
      {children}
    </Ctx.Provider>
  );
}
