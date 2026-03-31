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

export async function fetchAssetStorage(): Promise<{ mode: 'nas' | 'local'; path: string }> {
  return apiRequest(`${BASE}/asset-storage`);
}

export async function fetchAssets(category: AssetCategory): Promise<AssetListResponse> {
  return apiRequest<AssetListResponse>(`${BASE}/assets/${category}`);
}

export async function uploadAsset(
  category: AssetCategory,
  file: File,
  subfolder?: string,
  onProgress?: (percent: number) => void,
  onPhase?: (phase: 'uploading' | 'processing') => void,
  signal?: AbortSignal,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const url = subfolder
    ? `${BASE}/assets/${category}/upload?subfolder=${encodeURIComponent(subfolder)}`
    : `${BASE}/assets/${category}/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress?.(pct);
        if (pct >= 100) {
          onPhase?.('processing');
        }
      }
    });

    xhr.upload.addEventListener('load', () => {
      // Belt-and-suspenders: also trigger processing on upload.load
      onPhase?.('processing');
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { fileName: string };
          resolve(data.fileName);
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          reject(new Error(body.error || xhr.statusText));
        } catch {
          reject(new Error(xhr.statusText));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload fehlgeschlagen')));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload abgebrochen', 'AbortError')));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

export async function fetchVideoCover(fileName: string): Promise<{ posterPath: string | null; logs: string[] }> {
  const res = await fetch(`${BASE}/assets/videos/fetch-cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
  });
  const data = await res.json() as { posterPath?: string | null; logs?: string[]; error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { logs: data.logs ?? [] });
  return { posterPath: data.posterPath ?? null, logs: data.logs ?? [] };
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
