// Image URL fetching helpers, used by the DAM `download-url` and `replace`
// endpoints. Extracted from `server/index.ts` so they can be unit-tested
// without the side effects of importing the whole server module (which binds
// to a port and loads config on import).
//
// Two public functions:
//   - `sniffImageExt(buffer, contentType?)` — magic-byte sniffer for raster
//     formats plus SVG (by Content-Type or `<svg>` / `<?xml>` prefix).
//   - `fetchImageBytesFromUrl(rawUrl)` — fetch, validate, return buffer +
//     derived filename. Unwraps Google/Bing image-result redirects so a URL
//     pasted from a search-result page resolves to the actual image.

import path from 'path';

// Unwrap common search-engine redirect wrappers so we fetch the real image,
// not an HTML redirect page. Examples:
//   google.com/imgres?imgurl=<real>&imgrefurl=…   → <real>
//   google.com/url?url=<real>&sa=…                → <real>
//   bing.com/images/search?…&mediaurl=<real>…     → <real>
export function unwrapImageRedirect(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const params = u.searchParams;
    if (host.endsWith('google.com') || host.endsWith('google.de')) {
      const imgurl = params.get('imgurl');
      if (imgurl && /^https?:\/\//i.test(imgurl)) return imgurl;
      const urlP = params.get('url') || params.get('q');
      if (urlP && /^https?:\/\//i.test(urlP)) return urlP;
    }
    if (host.endsWith('bing.com')) {
      const mediaurl = params.get('mediaurl');
      if (mediaurl && /^https?:\/\//i.test(mediaurl)) return decodeURIComponent(mediaurl);
    }
    return raw;
  } catch {
    return raw;
  }
}

export function sniffImageExt(buffer: Buffer, contentType?: string): string | null {
  if (buffer.length < 12) return null;
  const head = buffer.subarray(0, 16);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return '.png';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return '.gif';
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return '.webp';
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return '.avif';
  const headAscii = head.toString('ascii').trimStart();
  if ((contentType || '').includes('svg') || headAscii.startsWith('<svg') || headAscii.startsWith('<?xml')) return '.svg';
  return null;
}

export async function fetchImageBytesFromUrl(rawUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
  sniffedExt: string;
  derivedFileName: string;
}> {
  const url = unwrapImageRedirect(rawUrl);
  let referer = '';
  try { referer = new URL(url).origin + '/'; } catch { /* fetch will fail with a clear error below */ }
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      ...(referer ? { 'Referer': referer } : {}),
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('Empty response');

  const sniffed = sniffImageExt(buffer, contentType);
  const isImageContentType = contentType.startsWith('image/');
  if (!sniffed && !isImageContentType) {
    throw new Error(
      `Keine Bilddatei (Content-Type: ${contentType || 'unbekannt'}). ` +
      `Möglicherweise hat die Quelle eine HTML-Seite statt des Bildes geliefert — versuche, das Bild direkt zu ziehen statt eines Link-Vorschaubilds.`,
    );
  }

  const urlPath = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
  let derivedFileName = path.basename(urlPath).replace(/[?#].*$/, '');
  if (!path.extname(derivedFileName)) {
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
      'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif',
    };
    const ctExt = Object.entries(extMap).find(([ct]) => contentType.includes(ct))?.[1];
    const ext = ctExt || sniffed || '.jpg';
    derivedFileName = (derivedFileName || `download-${Date.now()}`) + ext;
  }
  if (!derivedFileName || derivedFileName === '/' || derivedFileName === '.') {
    derivedFileName = `download-${Date.now()}.jpg`;
  }

  return { buffer, contentType, sniffedExt: sniffed || path.extname(derivedFileName), derivedFileName };
}
