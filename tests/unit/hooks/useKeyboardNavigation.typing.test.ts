import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';

/**
 * The host types into on-screen inputs during a live show — the GuessingGame
 * tip fields most of all. Global navigation keys must not fire from there.
 *
 * The bug: pressing ArrowLeft to fix a digit called preventDefault() + onBack().
 * GuessingGame registers no backNavHandler, so BaseGameWrapper fell through to
 * setPhase('rules') — the projector jumped out of the question and both teams'
 * entered guesses were lost. Space was worse: it advanced the game mid-word.
 */
describe('useKeyboardNavigation — typing guard', () => {
  let field: HTMLElement | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    field?.remove();
    field = null;
    document.body.innerHTML = '';
  });

  function mountField(tag: 'input' | 'textarea' | 'select'): HTMLElement {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    field = el;
    return el;
  }

  function press(target: EventTarget, key: string) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  }

  it.each(['input', 'textarea', 'select'] as const)(
    'ignores ArrowLeft while focus is in a <%s>',
    (tag) => {
      const onNext = vi.fn();
      const onBack = vi.fn();
      renderHook(() => useKeyboardNavigation({ onNext, onBack }));

      press(mountField(tag), 'ArrowLeft');

      expect(onBack).not.toHaveBeenCalled();
      expect(onNext).not.toHaveBeenCalled();
    },
  );

  it('ignores ArrowRight while typing in an input', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    press(mountField('input'), 'ArrowRight');

    expect(onNext).not.toHaveBeenCalled();
  });

  it('ignores Space while typing in an input', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    press(mountField('input'), ' ');

    expect(onNext).not.toHaveBeenCalled();
  });

  it('ignores keys inside a contenteditable region', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    field = div;

    press(div, 'ArrowRight');

    expect(onNext).not.toHaveBeenCalled();
  });

  it('still navigates when the event does not come from a text field', () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext, onBack }));

    press(document, 'ArrowRight');
    expect(onNext).toHaveBeenCalledTimes(1);

    press(document, 'ArrowLeft');
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
