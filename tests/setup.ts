import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { clearPlaythroughStore } from '@/utils/gamePlaythroughStore';
import { __resetSaveQueueForTests } from '@/services/saveQueue';

// Testing-library's `waitFor` defaults to a 1000 ms timeout, which is not enough
// headroom when the whole suite runs in parallel on a contended machine — a
// 2-core CI runner, or any laptop where vitest saturates every core. A React
// render plus an async chain (fetch mock → state update → effect → repaint)
// routinely overruns 1 s under that load even though it takes ~20 ms idle.
//
// The symptom was a rotating cast of "failures": the same commit tree passed CI
// twice and failed twice, and locally three different specs
// (AssetsTab drag-to-move, GameScreen.liveReload, GameshowsTab) each failed in
// some full-suite runs while passing 6-12/12 in isolation. Every one was a
// `waitFor` timeout, never an assertion mismatch — i.e. the tests were racing
// the clock, not catching bugs.
//
// Raising the ceiling costs nothing on a passing run (`waitFor` resolves as soon
// as the condition holds) and only extends how long a genuinely failing test
// takes to report.
configure({ asyncUtilTimeout: 5000 });

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock HTMLAudioElement
class MockAudio {
  src = '';
  volume = 1;
  currentTime = 0;
  duration = 0;
  paused = true;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;

  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  addEventListener() {}
  removeEventListener() {}
}

(globalThis as any).Audio = MockAudio;

// Mock HTMLMediaElement prototype for <audio> JSX elements (jsdom doesn't implement play/pause)
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = function() {
    Object.defineProperty(this, 'paused', { value: false, writable: true, configurable: true });
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function() {
    Object.defineProperty(this, 'paused', { value: true, writable: true, configurable: true });
  };
  HTMLMediaElement.prototype.load = function() {};
}

// Mock window.confirm
window.confirm = () => true;

// Mock requestAnimationFrame (no-op to avoid lingering async loops like confetti)
let rafId = 0;
globalThis.requestAnimationFrame = window.requestAnimationFrame = (_cb: FrameRequestCallback) => ++rafId;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame = () => {};

// Mock IntersectionObserver (not available in jsdom)
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = MockResizeObserver;

// Mock scrollTo (not available in jsdom)
Element.prototype.scrollTo = () => {};
window.scrollTo = () => {};
document.documentElement.scrollTo = () => {};

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = () => {};
document.body.scrollTo = () => {};

// Reset localStorage before each test
beforeEach(() => {
  localStorage.clear();
  // The playthrough store (shuffle seed + reconciled question order + how far the
  // show got) is module-level and session-scoped, so without this a test would
  // inherit the deck and progress of the previous test that used the same
  // gameId. Clearing it models a fresh page load. See specs/live-question-order.md.
  clearPlaythroughStore();
  // The admin save queue is module-level and deliberately outlives every component,
  // so a queued payload, a live retry timer or a leftover listener would follow a
  // test into the next one. See specs/admin-save-queue.md.
  __resetSaveQueueForTests();
});
