import { describe, it, expect, vi } from 'vitest';
import { resolveVideoGuessLanguage, type VideoProbeFn } from '../../../server/video-guess-resolver.js';
import type { VideoGuessConfig } from '../../../src/types/config.js';
import type { VideoTrackInfo } from '../../../server/video-probe.js';

function track(index: number, language: string): VideoTrackInfo {
  return {
    index,
    codec: 'aac',
    codecLong: 'AAC',
    channels: 2,
    channelLayout: 'stereo',
    language,
    name: '',
    isDefault: index === 0,
    browserCompatible: true,
  };
}

function cfg(overrides: Partial<VideoGuessConfig>, questions: VideoGuessConfig['questions']): VideoGuessConfig {
  return {
    type: 'video-guess',
    title: 'T',
    questions,
    ...overrides,
  };
}

describe('resolveVideoGuessLanguage', () => {
  it('leaves explicit audioTrack untouched', async () => {
    const c = cfg({}, [{ answer: 'a', video: '/videos/x.mp4', audioTrack: 2 }]);
    const probe = vi.fn<VideoProbeFn>();
    await resolveVideoGuessLanguage(c, probe);
    expect(c.questions[0].audioTrack).toBe(2);
    expect(probe).not.toHaveBeenCalled();
  });

  it('with no instance language, sets audioTrack=0 when video has tracks', async () => {
    const c = cfg({}, [{ answer: 'a', video: '/videos/x.mp4' }]);
    const probe: VideoProbeFn = async () => ({ tracks: [track(0, 'deu'), track(1, 'eng'), track(2, 'fra')] });
    await resolveVideoGuessLanguage(c, probe);
    expect(c.questions[0].audioTrack).toBe(0);
  });

  it('with no instance language, leaves audioTrack undefined when video has zero tracks', async () => {
    const c = cfg({}, [{ answer: 'a', video: '/videos/x.mp4' }]);
    const probe: VideoProbeFn = async () => ({ tracks: [] });
    await resolveVideoGuessLanguage(c, probe);
    expect(c.questions[0].audioTrack).toBeUndefined();
  });

  it('with no instance language, leaves audioTrack undefined when probe fails', async () => {
    const c = cfg({}, [{ answer: 'a', video: '/videos/x.mp4' }]);
    const probe: VideoProbeFn = async () => { throw new Error('ffprobe exploded'); };
    await resolveVideoGuessLanguage(c, probe);
    expect(c.questions[0].audioTrack).toBeUndefined();
  });

  it('with instance language, resolves to matching track index', async () => {
    const c = cfg({ language: 'deu' }, [{ answer: 'a', video: '/videos/x.mp4' }]);
    const probe: VideoProbeFn = async () => ({ tracks: [track(0, 'eng'), track(1, 'deu'), track(2, 'fra')] });
    await resolveVideoGuessLanguage(c, probe);
    expect(c.questions[0].audioTrack).toBe(1);
  });

  it('with instance language but no matching track, leaves audioTrack undefined', async () => {
    const c = cfg({ language: 'deu' }, [{ answer: 'a', video: '/videos/x.mp4' }]);
    const probe: VideoProbeFn = async () => ({ tracks: [track(0, 'eng'), track(1, 'fra')] });
    await resolveVideoGuessLanguage(c, probe);
    expect(c.questions[0].audioTrack).toBeUndefined();
  });

  it('skips questions with missing video', async () => {
    const c = cfg({}, [{ answer: 'a', video: '' }]);
    const probe = vi.fn<VideoProbeFn>();
    await resolveVideoGuessLanguage(c, probe);
    expect(c.questions[0].audioTrack).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it('caches probe results per video path', async () => {
    const c = cfg({}, [
      { answer: 'a', video: '/videos/x.mp4' },
      { answer: 'b', video: '/videos/x.mp4' },
      { answer: 'c', video: '/videos/y.mp4' },
    ]);
    const probe = vi.fn<VideoProbeFn>(async () => ({ tracks: [track(0, 'deu')] }));
    await resolveVideoGuessLanguage(c, probe);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenNthCalledWith(1, 'x.mp4');
    expect(probe).toHaveBeenNthCalledWith(2, 'y.mp4');
    expect(c.questions.map(q => q.audioTrack)).toEqual([0, 0, 0]);
  });

  it('strips leading /videos/ from the video path when probing', async () => {
    const c = cfg({}, [{ answer: 'a', video: '/videos/sub/dir/clip.mp4' }]);
    const probe = vi.fn<VideoProbeFn>(async () => ({ tracks: [track(0, 'deu')] }));
    await resolveVideoGuessLanguage(c, probe);
    expect(probe).toHaveBeenCalledWith('sub/dir/clip.mp4');
  });
});
