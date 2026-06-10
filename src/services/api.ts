import type { SettingsResponse, GameDataResponse } from '@/types/config';

/** Error carrying the HTTP status of a failed fetch so callers can branch on it
 *  (e.g. GameScreen treats a 404 on a live refresh as "this game no longer
 *  exists" → jump to the next game / summary). */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new HttpError(res.status, 'Failed to fetch settings');
  return res.json();
}

export async function fetchGameData(index: number): Promise<GameDataResponse> {
  const res = await fetch(`/api/game/${index}`);
  if (!res.ok) throw new HttpError(res.status, `Failed to fetch game ${index}`);
  return res.json();
}

export async function fetchBackgroundMusic(theme?: string): Promise<string[]> {
  const url = theme ? `/api/background-music?theme=${encodeURIComponent(theme)}` : '/api/background-music';
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(res.status, 'Failed to fetch background music');
  return res.json();
}

export interface ThemeSettings {
  frontend: string;
  admin: string;
}

export async function fetchTheme(): Promise<ThemeSettings> {
  const res = await fetch('/api/theme');
  if (!res.ok) throw new HttpError(res.status, 'Failed to fetch theme');
  return res.json();
}

export async function saveTheme(settings: Partial<ThemeSettings>): Promise<ThemeSettings> {
  const res = await fetch('/api/theme', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new HttpError(res.status, 'Failed to save theme');
  return res.json();
}

export async function checkVideoHdr(videoPath: string): Promise<boolean> {
  const res = await fetch(`/api/video-hdr?path=${encodeURIComponent(videoPath)}`);
  if (!res.ok) return false;
  const data = await res.json() as { isHdr: boolean };
  return data.isHdr;
}
