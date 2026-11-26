import { createContext, useContext, type ReactNode } from 'react';
import { useBackgroundMusic, type MusicPlayerControls } from '@/hooks/useBackgroundMusic';
import type { BackgroundMusicSource } from '@/types/config';

const MusicContext = createContext<MusicPlayerControls | null>(null);

export function MusicProvider({ children, source }: { children: ReactNode; source?: BackgroundMusicSource }) {
  const player = useBackgroundMusic(source);
  return <MusicContext.Provider value={player}>{children}</MusicContext.Provider>;
}

export function useMusicPlayer(): MusicPlayerControls {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusicPlayer must be used inside MusicProvider');
  return ctx;
}
