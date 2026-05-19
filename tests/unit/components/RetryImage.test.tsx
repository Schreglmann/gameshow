import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import RetryImage from '@/components/common/RetryImage';

function getImg(): HTMLImageElement {
  const img = document.querySelector('img');
  if (!img) throw new Error('img not found');
  return img;
}

describe('RetryImage', () => {
  it('renders without cache-bust on initial render', () => {
    render(<RetryImage src="/images/foo.jpg" alt="" />);
    expect(getImg().getAttribute('src')).toBe('/images/foo.jpg');
  });

  it('appends ?v=1 cache-bust on first error', () => {
    render(<RetryImage src="/images/foo.jpg" alt="" />);
    act(() => { fireEvent.error(getImg()); });
    expect(getImg().getAttribute('src')).toBe('/images/foo.jpg?v=1');
  });

  it('appends &v=N when URL already contains a query string', () => {
    render(<RetryImage src="/images/foo.jpg?v=1234" alt="" />);
    act(() => { fireEvent.error(getImg()); });
    expect(getImg().getAttribute('src')).toBe('/images/foo.jpg?v=1234&v=1');
  });

  it('retries up to maxRetries times then calls onFinalFailure once', () => {
    const onFinalFailure = vi.fn();
    render(
      <RetryImage src="/images/foo.jpg" alt="" maxRetries={2} onFinalFailure={onFinalFailure} />
    );
    act(() => { fireEvent.error(getImg()); });
    expect(getImg().getAttribute('src')).toBe('/images/foo.jpg?v=1');
    act(() => { fireEvent.error(getImg()); });
    expect(getImg().getAttribute('src')).toBe('/images/foo.jpg?v=2');
    expect(onFinalFailure).not.toHaveBeenCalled();
    act(() => { fireEvent.error(getImg()); });
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
    // src stays at last attempted version after final failure
    expect(getImg().getAttribute('src')).toBe('/images/foo.jpg?v=2');
    // Further error events do not re-fire the callback
    act(() => { fireEvent.error(getImg()); });
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
  });

  it('resets attempt counter when src changes', () => {
    const { rerender } = render(<RetryImage src="/images/a.jpg" alt="" />);
    act(() => { fireEvent.error(getImg()); });
    expect(getImg().getAttribute('src')).toBe('/images/a.jpg?v=1');
    rerender(<RetryImage src="/images/b.jpg" alt="" />);
    // New src — no cache-bust on initial render
    expect(getImg().getAttribute('src')).toBe('/images/b.jpg');
  });

  it('forwards alt, className, and onLoad to the underlying img', () => {
    const onLoad = vi.fn();
    render(
      <RetryImage src="/images/foo.jpg" alt="Test alt" className="quiz-image" onLoad={onLoad} />
    );
    const img = getImg();
    expect(img.getAttribute('alt')).toBe('Test alt');
    expect(img.getAttribute('class')).toBe('quiz-image');
    act(() => { fireEvent.load(img); });
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('does not call onFinalFailure when maxRetries=0 unless first attempt errors', () => {
    const onFinalFailure = vi.fn();
    render(
      <RetryImage src="/images/foo.jpg" alt="" maxRetries={0} onFinalFailure={onFinalFailure} />
    );
    expect(onFinalFailure).not.toHaveBeenCalled();
    act(() => { fireEvent.error(getImg()); });
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
  });

  describe('slow-load timeout', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('treats a stalled load as failed after slowLoadMs', () => {
      const onFinalFailure = vi.fn();
      render(
        <RetryImage src="/images/foo.jpg" alt="" maxRetries={0} slowLoadMs={3000} onFinalFailure={onFinalFailure} />
      );
      expect(getImg().getAttribute('src')).toBe('/images/foo.jpg');
      act(() => { vi.advanceTimersByTime(3001); });
      expect(onFinalFailure).toHaveBeenCalledTimes(1);
    });

    it('does NOT trigger the timeout if onLoad fires first', () => {
      const onFinalFailure = vi.fn();
      render(
        <RetryImage src="/images/foo.jpg" alt="" maxRetries={0} slowLoadMs={3000} onFinalFailure={onFinalFailure} />
      );
      act(() => { fireEvent.load(getImg()); });
      act(() => { vi.advanceTimersByTime(10000); });
      expect(onFinalFailure).not.toHaveBeenCalled();
    });

    it('cancel-bust + retry after slow load with maxRetries=1', () => {
      const onFinalFailure = vi.fn();
      render(
        <RetryImage src="/images/foo.jpg" alt="" maxRetries={1} slowLoadMs={2000} onFinalFailure={onFinalFailure} />
      );
      // 1st attempt times out → retry with ?v=1
      act(() => { vi.advanceTimersByTime(2001); });
      expect(getImg().getAttribute('src')).toBe('/images/foo.jpg?v=1');
      expect(onFinalFailure).not.toHaveBeenCalled();
      // 2nd attempt also times out → final failure
      act(() => { vi.advanceTimersByTime(2001); });
      expect(onFinalFailure).toHaveBeenCalledTimes(1);
    });
  });
});
