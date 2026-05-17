import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sniffImageExt, fetchImageBytesFromUrl } from '../../../server/image-fetch.js';

// `sniffImageExt` + `fetchImageBytesFromUrl` live in a side-effect-free module
// so we can import them in unit tests without booting the server. The full
// atomic-swap endpoint is exercised by the e2e suite; here we lock down the
// magic-byte sniffer and the URL fetch path (HTML rejection, magic-byte
// fallback, redirect unwrap).

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG_HEAD  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GIF_HEAD  = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const WEBP_HEAD = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const AVIF_HEAD = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
const SVG_HEAD  = Buffer.from('<?xml version="1.0"?><svg xmlns="..."></svg>', 'utf8');
const HTML_HEAD = Buffer.from('<!DOCTYPE html><html><body>not an image</body></html>', 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sniffImageExt', () => {
  it('detects JPEG', () => expect(sniffImageExt(JPEG_HEAD)).toBe('.jpg'));
  it('detects PNG',  () => expect(sniffImageExt(PNG_HEAD)).toBe('.png'));
  it('detects GIF',  () => expect(sniffImageExt(GIF_HEAD)).toBe('.gif'));
  it('detects WebP', () => expect(sniffImageExt(WEBP_HEAD)).toBe('.webp'));
  it('detects AVIF', () => expect(sniffImageExt(AVIF_HEAD)).toBe('.avif'));
  it('detects SVG by content', () => expect(sniffImageExt(SVG_HEAD)).toBe('.svg'));
  it('detects SVG by content-type even without bytes match', () => {
    expect(sniffImageExt(Buffer.from('not really xml'), 'image/svg+xml')).toBe('.svg');
  });
  it('returns null for HTML', () => expect(sniffImageExt(HTML_HEAD)).toBeNull());
  it('returns null for empty buffer', () => expect(sniffImageExt(Buffer.alloc(0))).toBeNull());
});

describe('fetchImageBytesFromUrl', () => {
  function stubFetch(response: { ok?: boolean; status?: number; contentType?: string; body: Buffer }) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': response.contentType ?? 'application/octet-stream' }),
      arrayBuffer: async () => response.body.buffer.slice(response.body.byteOffset, response.body.byteOffset + response.body.byteLength),
    } as Response)));
  }

  it('returns buffer + sniffed extension for a valid PNG', async () => {
    stubFetch({ contentType: 'image/png', body: PNG_HEAD });
    const r = await fetchImageBytesFromUrl('https://example.com/foo.png');
    expect(r.sniffedExt).toBe('.png');
    expect(r.buffer.length).toBeGreaterThan(0);
  });

  it('rejects HTML response masquerading as image', async () => {
    stubFetch({ contentType: 'text/html', body: HTML_HEAD });
    await expect(fetchImageBytesFromUrl('https://hotlink-protected.example/x'))
      .rejects.toThrow(/Keine Bilddatei|HTML/i);
  });

  it('rejects empty response', async () => {
    stubFetch({ contentType: 'image/png', body: Buffer.alloc(0) });
    await expect(fetchImageBytesFromUrl('https://example.com/empty'))
      .rejects.toThrow(/Empty response/i);
  });

  it('rejects non-2xx HTTP', async () => {
    stubFetch({ ok: false, status: 403, contentType: 'image/png', body: PNG_HEAD });
    await expect(fetchImageBytesFromUrl('https://forbidden.example/x'))
      .rejects.toThrow(/HTTP 403/);
  });

  it('unwraps Google Images redirect URL before fetching', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => JPEG_HEAD.buffer.slice(JPEG_HEAD.byteOffset, JPEG_HEAD.byteOffset + JPEG_HEAD.byteLength),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const wrapped = 'https://www.google.com/imgres?imgurl=https%3A%2F%2Freal.example%2Fbig.jpg&imgrefurl=…';
    const r = await fetchImageBytesFromUrl(wrapped);

    expect(r.sniffedExt).toBe('.jpg');
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    // The unwrap helper extracts the imgurl param (possibly URL-encoded or
    // already decoded by the URL parser).
    expect(calledUrl).toMatch(/real\.example/);
  });

  it('derives a sensible filename from URL path when extension present', async () => {
    stubFetch({ contentType: 'image/png', body: PNG_HEAD });
    const r = await fetchImageBytesFromUrl('https://example.com/path/to/photo.png');
    expect(r.derivedFileName).toBe('photo.png');
  });

  it('appends an extension when URL path has none', async () => {
    stubFetch({ contentType: 'image/jpeg', body: JPEG_HEAD });
    const r = await fetchImageBytesFromUrl('https://example.com/no-ext-here');
    expect(r.derivedFileName).toMatch(/\.jpg$/);
  });
});
