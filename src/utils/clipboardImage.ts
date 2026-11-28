// Turns a clipboard paste into an image candidate for the asset picker.

export type PastedImage =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string };

/** Returns the URL when `text` is exactly one http(s) URL, otherwise null. */
export function parseSingleHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Converts a base64 `data:image/...` URL into a File, otherwise returns null. */
export function dataUrlToFile(text: string, baseName = 'image'): File | null {
  const match = /^data:(image\/([a-z0-9.-]+)(?:\+[a-z0-9.-]+)?);base64,([a-z0-9+/=\s]+)$/i.exec(text.trim());
  const [, mime, subtype, payload] = match ?? [];
  if (!mime || !subtype || !payload) return null;
  const type = mime.toLowerCase();
  let binary: string;
  try {
    binary = atob(payload.replace(/\s/g, ''));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = subtype.toLowerCase();
  return new File([bytes], `${baseName}.${ext}`, { type });
}

/**
 * Reads an image from clipboard data: an `image/*` item first, then a
 * `data:image` URL, then a single http(s) URL. Returns null for anything else,
 * so the caller can let ordinary text pastes through.
 */
export function readPastedImage(data: DataTransfer | null): PastedImage | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return { kind: 'file', file };
    }
  }
  const text = data.getData('text/plain') || data.getData('text/uri-list') || '';
  const dataFile = dataUrlToFile(text);
  if (dataFile) return { kind: 'file', file: dataFile };
  const url = parseSingleHttpUrl(text);
  if (url) return { kind: 'url', url };
  return null;
}
