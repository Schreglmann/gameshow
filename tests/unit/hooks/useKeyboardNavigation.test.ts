import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// We test the keyboard navigation hook in isolation
describe('useKeyboardNavigation', () => {
  let useKeyboardNavigation: typeof import('@/hooks/useKeyboardNavigation').useKeyboardNavigation;

  beforeEach(async () => {
    // Dynamically import to get fresh module state
    const mod = await import('@/hooks/useKeyboardNavigation');
    useKeyboardNavigation = mod.useKeyboardNavigation;
  });

  it('calls onNext when ArrowRight is pressed', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' })
      );
    });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onBack when ArrowLeft is pressed', () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext, onBack }));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      );
    });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not call onBack when ArrowLeft is pressed and onBack is not provided', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      );
    });

    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not fire when enabled is false', () => {
    const onNext = vi.fn();
    renderHook(() =>
      useKeyboardNavigation({ onNext, enabled: false })
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' })
      );
    });

    expect(onNext).not.toHaveBeenCalled();
  });

  it('calls onNext when clicking outside of interactive elements', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    // Create a regular div element to click on (not interactive)
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      div.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onNext).toHaveBeenCalledTimes(1);
    document.body.removeChild(div);
  });

  it('does not call onNext when clicking on a button', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const button = document.createElement('button');
    document.body.appendChild(button);

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onNext).not.toHaveBeenCalled();
    document.body.removeChild(button);
  });

  it('does not call onNext when clicking on an input', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onNext).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('does not call onNext when clicking inside music-controls', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const div = document.createElement('div');
    div.className = 'music-controls';
    const child = document.createElement('span');
    div.appendChild(child);
    document.body.appendChild(div);

    act(() => {
      child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onNext).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  it('does not call onNext when clicking on an img element', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const img = document.createElement('img');
    document.body.appendChild(img);

    act(() => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onNext).not.toHaveBeenCalled();
    document.body.removeChild(img);
  });

  it('does not fire when lightbox is open', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    // Create lightbox element
    const lightbox = document.createElement('div');
    lightbox.id = 'imageLightbox';
    document.body.appendChild(lightbox);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' })
      );
    });

    expect(onNext).not.toHaveBeenCalled();
    document.body.removeChild(lightbox);
  });

  it('ignores unrelated keys', () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext, onBack }));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      );
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape' })
      );
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a' })
      );
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('cleans up event listeners on unmount', () => {
    const onNext = vi.fn();
    const { unmount } = renderHook(() => useKeyboardNavigation({ onNext }));

    unmount();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' })
      );
    });

    expect(onNext).not.toHaveBeenCalled();
  });
});
