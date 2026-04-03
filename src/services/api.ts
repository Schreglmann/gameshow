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

export async function fetchBackgroundMusic(): Promise<string[]> {
  const res = await fetch('/api/background-music');
  if (!res.ok) throw new Error('Failed to fetch background music');
  return res.json();
}

export async function checkVideoHdr(videoPath: string): Promise<boolean> {
  const res = await fetch(`/api/video-hdr?path=${encodeURIComponent(videoPath)}`);
  if (!res.ok) return false;
  const data = await res.json() as { isHdr: boolean };
  return data.isHdr;
}
