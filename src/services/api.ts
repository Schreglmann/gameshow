import type { SettingsResponse, GameDataResponse } from '@/types/config';

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function fetchGameData(index: number): Promise<GameDataResponse> {
  const res = await fetch(`/api/game/${index}`);
  if (!res.ok) throw new Error(`Failed to fetch game ${index}`);
  return res.json();
}

export async function fetchBackgroundMusic(theme?: string): Promise<string[]> {
  const url = theme ? `/api/background-music?theme=${encodeURIComponent(theme)}` : '/api/background-music';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch background music');
  return res.json();
}

export interface ThemeSettings {
  frontend: string;
  admin: string;
}

export async function fetchTheme(): Promise<ThemeSettings> {
  const res = await fetch('/api/theme');
  if (!res.ok) throw new Error('Failed to fetch theme');
  return res.json();
}

export async function saveTheme(settings: Partial<ThemeSettings>): Promise<ThemeSettings> {
  const res = await fetch('/api/theme', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to save theme');
  return res.json();
}

export async function checkVideoHdr(videoPath: string): Promise<boolean> {
  const res = await fetch(`/api/video-hdr?path=${encodeURIComponent(videoPath)}`);
  if (!res.ok) return false;
  const data = await res.json() as { isHdr: boolean };
  return data.isHdr;
}
