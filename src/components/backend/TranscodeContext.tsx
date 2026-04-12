import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { startTranscode, type TranscodeJob } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';

interface TranscodeContextValue {
  /** Map of filePath → job for all active/recent transcode jobs */
  jobs: Map<string, TranscodeJob>;
  /** Start a transcode for a video file (relative path) */
  startJob: (filePath: string, hdrToSdr?: boolean) => Promise<void>;
}

const Ctx = createContext<TranscodeContextValue>(null!);

export function useTranscode() { return useContext(Ctx); }

export function TranscodeProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Map<string, TranscodeJob>>(new Map());

  // Receive transcode status via WebSocket push
  useWsChannel<{ jobs: TranscodeJob[] }>('transcode-status', (data) => {
    const map = new Map<string, TranscodeJob>();
    data.jobs.forEach(j => map.set(j.filePath, j));
    setJobs(map);
  });

  const startJob = useCallback(async (filePath: string, hdrToSdr?: boolean) => {
    await startTranscode(filePath, hdrToSdr);
    // Optimistically add a running job so UI updates immediately
    setJobs(prev => {
      const next = new Map(prev);
      next.set(filePath, { filePath, percent: 0, status: 'running', phase: 'encoding', startedAt: Date.now(), elapsed: 0 });
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ jobs, startJob }}>
      {children}
    </Ctx.Provider>
  );
}
