import type { AppConfig, GameFileSummary, AssetCategory, AssetListResponse } from '../types/config';

const BASE = '/api/backend';

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Games ──

export async function fetchGames(): Promise<GameFileSummary[]> {
  const data = await apiRequest<{ games: GameFileSummary[] }>(`${BASE}/games`);
  return data.games;
}

export async function fetchGame(fileName: string): Promise<unknown> {
  return apiRequest(`${BASE}/games/${encodeURIComponent(fileName)}`);
}

export async function saveGame(fileName: string, gameFile: unknown): Promise<void> {
  await apiRequest(`${BASE}/games/${encodeURIComponent(fileName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gameFile),
  });
}

export async function createGame(fileName: string, gameFile: unknown): Promise<void> {
  await apiRequest(`${BASE}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, gameFile }),
  });
}

export async function deleteGame(fileName: string): Promise<void> {
  await apiRequest(`${BASE}/games/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
}

// ── Config ──

export async function fetchConfig(): Promise<AppConfig> {
  return apiRequest<AppConfig>(`${BASE}/config`);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await apiRequest(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

// ── Assets ──

export async function fetchAssets(category: AssetCategory): Promise<AssetListResponse> {
  return apiRequest<AssetListResponse>(`${BASE}/assets/${category}`);
}

export async function uploadAsset(
  category: AssetCategory,
  file: File,
  subfolder?: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const url = subfolder
    ? `${BASE}/assets/${category}/upload?subfolder=${encodeURIComponent(subfolder)}`
    : `${BASE}/assets/${category}/upload`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText) as { fileName: string };
        resolve(data.fileName);
      } else {
        const err = (() => { try { return JSON.parse(xhr.responseText)?.error; } catch { return null; } })();
        reject(new Error(err || `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

export async function createAssetFolder(category: AssetCategory, folderPath: string): Promise<void> {
  await apiRequest(`${BASE}/assets/${category}/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath }),
  });
}

export async function deleteAsset(category: AssetCategory, filePath: string): Promise<void> {
  await apiRequest(`${BASE}/assets/${category}/${filePath}`, { method: 'DELETE' });
}

export async function moveAsset(category: AssetCategory, from: string, to: string): Promise<void> {
  await apiRequest(`${BASE}/assets/${category}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
}

export async function fetchAssetUsages(
  category: AssetCategory,
  file: string
): Promise<{ fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[] }[]> {
  const data = await apiRequest<{ games: { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[] }[] }>(
    `${BASE}/asset-usages?category=${category}&file=${encodeURIComponent(file)}`
  );
  return data.games;
}
