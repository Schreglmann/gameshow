import { describe, it, expect } from 'vitest';
import { parseYouTubeVideoId, youTubeEmbedUrl, youTubeWatchUrl } from '@/utils/youtube';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeVideoId', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
    `https://www.youtube.com/live/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}  `,
  ])('extracts the id from %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBe(ID);
  });

  it.each([
    '',
    'never gonna give you up',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@RickAstleyYT',
    `https://example.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=tooShort',
    `https://youtu.be/${ID}extra`,
  ])('returns null for %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBeNull();
  });
});

describe('YouTube URL builders', () => {
  it('builds the privacy-enhanced embed URL', () => {
    expect(youTubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
  });

  it('builds the canonical watch URL', () => {
    expect(youTubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});
