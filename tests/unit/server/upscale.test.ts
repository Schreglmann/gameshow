import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCacheKey,
  getCachedUpscale,
  predictOutputDims,
  UpscaleError,
  UPSCALE_MODELS,
  UPSCALE_SUPPORTED_EXTS,
  _clearCacheForTests,
} from '../../../server/upscale.js';

// Tests for the side-effect-free pieces of server/upscale.ts. The actual
// spawn path needs a real upscayl-bin and is exercised by the e2e fixme +
// manual verification — not unit tests.

describe('upscale: buildCacheKey', () => {
  it('embeds model + scale + extension in the key', () => {
    const bytes = Buffer.from('hello world');
    const k = buildCacheKey(bytes, 'ultramix_balanced', 4, '.jpg');
    expect(k).toMatch(/^[a-f0-9]{40}-ultramix_balanced-4x\.jpg$/);
  });

  it('different bytes yield different keys', () => {
    const a = buildCacheKey(Buffer.from('a'), 'ultrasharp', 2, '.png');
    const b = buildCacheKey(Buffer.from('b'), 'ultrasharp', 2, '.png');
    expect(a).not.toBe(b);
  });

  it('same bytes + different model yield different keys', () => {
    const b = Buffer.from('same');
    expect(buildCacheKey(b, 'ultramix_balanced', 4, '.jpg'))
      .not.toBe(buildCacheKey(b, 'digital_art', 4, '.jpg'));
  });

  it('normalises extension to lower case in the key', () => {
    const b = Buffer.from('same');
    const upper = buildCacheKey(b, 'ultrasharp', 2, '.JPG');
    expect(upper.endsWith('.jpg')).toBe(true);
  });
});

describe('upscale: getCachedUpscale', () => {
  beforeEach(() => { _clearCacheForTests(); });

  it('returns null for an unknown key', () => {
    expect(getCachedUpscale('does-not-exist')).toBeNull();
  });
});

describe('upscale: predictOutputDims', () => {
  it('multiplies every dimension by scale (4×)', () => {
    expect(predictOutputDims({ w: 200, h: 150 }, 4)).toEqual({ w: 800, h: 600 });
  });

  it('honours the scale literally — no envelope clamp', () => {
    // A high-res source upscaled by 4× should produce 4× output, even when
    // that exceeds 1920×1080.
    expect(predictOutputDims({ w: 1000, h: 500 }, 4)).toEqual({ w: 4000, h: 2000 });
  });

  it('handles 2× scale', () => {
    expect(predictOutputDims({ w: 100, h: 100 }, 2)).toEqual({ w: 200, h: 200 });
  });
});

describe('upscale: constants', () => {
  it('exposes the three expected models in catalog order', () => {
    expect(UPSCALE_MODELS).toEqual(['ultramix_balanced', 'ultrasharp', 'digital_art']);
  });

  it('declares supported source extensions', () => {
    expect(UPSCALE_SUPPORTED_EXTS).toContain('.jpg');
    expect(UPSCALE_SUPPORTED_EXTS).toContain('.jpeg');
    expect(UPSCALE_SUPPORTED_EXTS).toContain('.png');
    expect(UPSCALE_SUPPORTED_EXTS).toContain('.webp');
    expect(UPSCALE_SUPPORTED_EXTS).not.toContain('.gif');
    expect(UPSCALE_SUPPORTED_EXTS).not.toContain('.svg');
  });
});

describe('upscale: stderr percent parser', () => {
  // Mirrors the regex used in spawnUpscaler() to pull tile-completion
  // percents off upscayl-ncnn's stderr. Single source of truth lives in
  // server/upscale.ts; this test pins the contract.
  const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/g;
  const parseAll = (chunk: string): number[] => {
    const out: number[] = [];
    for (const m of chunk.matchAll(PERCENT_RE)) {
      const p = parseFloat(m[1]);
      if (p >= 0 && p <= 100) out.push(p);
    }
    return out;
  };

  it('extracts a single percent from a tile line', () => {
    expect(parseAll('25.00%\n')).toEqual([25]);
  });

  it('handles multiple percents in one chunk', () => {
    expect(parseAll('12.50%\n25.00%\n37.50%\n')).toEqual([12.5, 25, 37.5]);
  });

  it('accepts integer percent lines', () => {
    expect(parseAll('100%\n')).toEqual([100]);
  });

  it('ignores non-percent stderr noise', () => {
    expect(parseAll('[0] AMD Radeon Pro\nusing vulkan device 0\n')).toEqual([]);
  });

  it('drops out-of-range high values', () => {
    expect(parseAll('150.5%\n')).toEqual([]);
  });
});

describe('upscale: UpscaleError', () => {
  it('preserves the code for the API to map to HTTP status', () => {
    const err = new UpscaleError('vulkan_missing', 'libvulkan1 missing');
    expect(err.code).toBe('vulkan_missing');
    expect(err.message).toBe('libvulkan1 missing');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('UpscaleError');
  });
});
