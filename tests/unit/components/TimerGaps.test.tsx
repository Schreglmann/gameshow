import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Timer from '@/components/common/Timer';

describe('Timer - Gaps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Zeit abgelaufen!" text when timer reaches zero', () => {
    const onComplete = vi.fn();
    const { rerender } = render(<Timer seconds={2} running={true} onComplete={onComplete} />);

    // Advance 2 seconds
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Parent would set running=false after onComplete
    rerender(<Timer seconds={2} running={false} onComplete={onComplete} />);

    expect(screen.getByText('Zeit abgelaufen!')).toBeInTheDocument();
  });

  it('applies timer-display--done class when timer finishes', () => {
    const { rerender } = render(<Timer seconds={1} running={true} onComplete={vi.fn()} />);

    act(() => { vi.advanceTimersByTime(1000); });

    rerender(<Timer seconds={1} running={false} onComplete={vi.fn()} />);

    const display = document.querySelector('.timer-display--done');
    expect(display).toBeInTheDocument();
  });

  it('plays timer-end audio when timer reaches zero', () => {
    const audioInstances: any[] = [];
    (globalThis as any).Audio = class MockAudio {
      src = '';
      play = vi.fn().mockReturnValue(Promise.resolve());
      pause = vi.fn();
      constructor(src?: string) {
        if (src) this.src = src;
        audioInstances.push(this);
      }
    };

    render(<Timer seconds={1} running={true} onComplete={vi.fn()} />);

    act(() => { vi.advanceTimersByTime(1000); });

    const timerEndAudio = audioInstances.find(a => a.src.includes('timer-end'));
    expect(timerEndAudio).toBeTruthy();
    expect(timerEndAudio.play).toHaveBeenCalled();
  });

  it('does not show "Zeit abgelaufen!" while timer is still running', () => {
    render(<Timer seconds={10} running={true} onComplete={vi.fn()} />);

    act(() => { vi.advanceTimersByTime(5000); });

    expect(screen.queryByText('Zeit abgelaufen!')).not.toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
  });

  it('does not show "Zeit abgelaufen!" when not running and not done', () => {
    render(<Timer seconds={10} running={false} onComplete={vi.fn()} />);

    expect(screen.queryByText('Zeit abgelaufen!')).not.toBeInTheDocument();
    expect(screen.getByText('10s')).toBeInTheDocument();
  });

  it('applies timer-display--low class at exactly 30% remaining', () => {
    render(<Timer seconds={10} running={true} onComplete={vi.fn()} />);

    // 10 * 0.3 = 3, so at 7 seconds elapsed (3 remaining) it should be "low"
    act(() => { vi.advanceTimersByTime(7000); });

    const display = document.querySelector('.timer-display--low');
    expect(display).toBeInTheDocument();
  });

  it('applies timer-display--critical at exactly 5 seconds', () => {
    render(<Timer seconds={60} running={true} onComplete={vi.fn()} />);

    // 60 - 55 = 5 seconds remaining
    act(() => { vi.advanceTimersByTime(55000); });

    const display = document.querySelector('.timer-display--critical');
    expect(display).toBeInTheDocument();
  });

  it('does not call onComplete multiple times', () => {
    const onComplete = vi.fn();
    render(<Timer seconds={1} running={true} onComplete={onComplete} />);

    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(2000); });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
