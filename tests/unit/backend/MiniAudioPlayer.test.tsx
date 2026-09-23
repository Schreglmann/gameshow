import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import MiniAudioPlayer from '@/components/backend/MiniAudioPlayer';

/**
 * The asset field's mini player previews the trimmed clip, not the whole file:
 * pressing play has to jump to the trim start (a 4-minute song trimmed to
 * 0:30–0:42 used to preview from 0:00) and stop again at the trim end.
 *
 * The global MockAudio in tests/setup.ts swallows listeners, so this suite swaps in
 * a fake that actually dispatches events — that is the only way the hook sees the
 * element at all.
 */
const instances: FakeAudio[] = [];

class FakeAudio {
  src = '';
  preload = 'none';
  currentTime = 0;
  duration = 240;
  paused = true;
  private listeners = new Map<string, Set<EventListener>>();

  constructor() { instances.push(this); }

  addEventListener(type: string, cb: EventListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: EventListener) {
    this.listeners.get(type)?.delete(cb);
  }
  dispatch(type: string) {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb(new Event(type));
  }
  load() {}
  play() { this.paused = false; this.dispatch('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatch('pause'); }

  /** Advance playback as the browser would: move the head, then fire timeupdate. */
  advanceTo(t: number) { this.currentTime = t; this.dispatch('timeupdate'); }
}

const realAudio = globalThis.Audio;
beforeEach(() => {
  instances.length = 0;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
});
afterEach(() => {
  cleanup();
  (globalThis as unknown as { Audio: unknown }).Audio = realAudio;
});

function play() {
  fireEvent.click(document.querySelector('.mini-player-btn')!);
}

function audio() {
  return instances[0]!;
}

/** Let the element report its duration so the clip length is known. */
function announceDuration() {
  act(() => { audio().dispatch('durationchange'); });
}

describe('MiniAudioPlayer trim', () => {
  it('starts playback at the trim start, not at the file start', () => {
    render(<MiniAudioPlayer src="/audio/song.mp3" scope="a" start={30} end={42} />);
    announceDuration();

    play();

    expect(audio().currentTime).toBe(30);
    expect(audio().paused).toBe(false);
  });

  it('stops at the trim end', () => {
    render(<MiniAudioPlayer src="/audio/song.mp3" scope="b" start={30} end={42} />);
    announceDuration();
    play();

    act(() => { audio().advanceTo(42.1); });

    expect(audio().paused).toBe(true);
    expect(audio().currentTime).toBe(42);
  });

  it('restarts at the trim start when looping', () => {
    render(<MiniAudioPlayer src="/audio/song.mp3" scope="c" start={30} end={42} loop />);
    announceDuration();
    play();

    act(() => { audio().advanceTo(42.1); });

    expect(audio().paused).toBe(false);
    expect(audio().currentTime).toBe(30);
  });

  it('replays the clip from the start once the end was reached', () => {
    render(<MiniAudioPlayer src="/audio/song.mp3" scope="d" start={30} end={42} />);
    announceDuration();
    play();
    act(() => { audio().advanceTo(42.1); });

    play();

    expect(audio().currentTime).toBe(30);
    expect(audio().paused).toBe(false);
  });

  it('counts the timestamp from the trim start', () => {
    render(<MiniAudioPlayer src="/audio/song.mp3" scope="e" start={30} end={42} />);
    announceDuration();

    expect(screen.getByText('0:00 / 0:12')).toBeInTheDocument();

    play();
    act(() => { audio().advanceTo(35); });

    expect(screen.getByText('0:05 / 0:12')).toBeInTheDocument();
  });

  it('plays the whole file when no trim is set', () => {
    render(<MiniAudioPlayer src="/audio/song.mp3" scope="f" />);
    announceDuration();

    play();
    act(() => { audio().advanceTo(90); });

    expect(audio().paused).toBe(false);
    expect(screen.getByText('1:30 / 4:00')).toBeInTheDocument();
  });
});
