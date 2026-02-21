import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

describe('useKeyboardNavigation - Gaps', () => {
  let useKeyboardNavigation: typeof import('@/hooks/useKeyboardNavigation').useKeyboardNavigation;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/hooks/useKeyboardNavigation');
    useKeyboardNavigation = mod.useKeyboardNavigation;
  });

  it('does not call onNext when clicking on a textarea', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.click();
    document.body.removeChild(textarea);

    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not call onNext when clicking on an anchor element', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const a = document.createElement('a');
    a.href = '#';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not call onNext when clicking on element with role="button"', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const roleBtn = document.createElement('div');
    roleBtn.setAttribute('role', 'button');
    document.body.appendChild(roleBtn);
    roleBtn.click();
    document.body.removeChild(roleBtn);

    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not call onNext when clicking inside #imageLightbox', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const lightbox = document.createElement('div');
    lightbox.id = 'imageLightbox';
    const child = document.createElement('span');
    lightbox.appendChild(child);
    document.body.appendChild(lightbox);
    child.click();
    document.body.removeChild(lightbox);

    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not fire ArrowRight when #imageLightbox is present', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const lightbox = document.createElement('div');
    lightbox.id = 'imageLightbox';
    document.body.appendChild(lightbox);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    document.body.removeChild(lightbox);

    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not call onBack when ArrowLeft is pressed without onBack', () => {
    const onNext = vi.fn();
    // No error should be thrown
    renderHook(() => useKeyboardNavigation({ onNext }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    // No crash = success
  });

  it('calls onNext for clicks on non-interactive elements', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.click();
    document.body.removeChild(div);

    expect(onNext).toHaveBeenCalled();
  });

  it('does not call onNext when clicking on img elements', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext }));

    const img = document.createElement('img');
    document.body.appendChild(img);
    img.click();
    document.body.removeChild(img);

    expect(onNext).not.toHaveBeenCalled();
  });

  it('re-enables when enabled changes from false to true', () => {
    const onNext = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useKeyboardNavigation({ onNext, enabled }),
      { initialProps: { enabled: false } }
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onNext).not.toHaveBeenCalled();

    rerender({ enabled: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
