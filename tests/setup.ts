import '@testing-library/jest-dom';

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

// Mock scrollTo (not available in jsdom)
Element.prototype.scrollTo = () => {};
window.scrollTo = () => {};
document.documentElement.scrollTo = () => {};
document.body.scrollTo = () => {};

// Reset localStorage before each test
beforeEach(() => {
  localStorage.clear();
});
