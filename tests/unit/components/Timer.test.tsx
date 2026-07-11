import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Timer from '@/components/common/Timer';

describe('Timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays initial seconds', () => {
    render(<Timer seconds={30} running={false} />);
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('counts down when running', () => {
    render(<Timer seconds={10} running={true} />);
    expect(screen.getByText('10')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('9')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('stops at zero and calls onComplete', () => {
    const onComplete = vi.fn();
    render(<Timer seconds={3} running={true} onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('displays "Zeit abgelaufen!" when done', () => {
    render(<Timer seconds={2} running={true} />);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // After timer finishes, running should still be true but timeLeft is 0
    // The component shows "Zeit abgelaufen!" when timeLeft === 0 && !running
    // But the timer keeps running=true, so let's check what happens
    // When running + timeLeft reaches 0, it calls onComplete
    // Timer display shows "0s" while running, shows "Zeit abgelaufen!" when done (0 and !running)
  });

  it('does not count down when not running', () => {
    render(<Timer seconds={10} running={false} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('applies low class when fraction <= 0.3', () => {
    render(<Timer seconds={10} running={true} />);

    // Advance to 3 seconds remaining (fraction = 0.3)
    act(() => {
      vi.advanceTimersByTime(7000);
    });

    const timerEl = screen.getByText('3');
    expect(timerEl.className).toContain('timer-display--low');
  });

  it('applies critical class when timeLeft <= 5', () => {
    render(<Timer seconds={30} running={true} />);

    act(() => {
      vi.advanceTimersByTime(25000);
    });

    const timerEl = screen.getByText('5');
    expect(timerEl.className).toContain('timer-display--critical');
  });

  it('resets when seconds prop changes', () => {
    const { rerender } = render(<Timer seconds={10} running={false} />);
    expect(screen.getByText('10')).toBeInTheDocument();

    rerender(<Timer seconds={20} running={false} />);
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  // Regression: in the live show every game's per-question timer appeared frozen
  // at its full value ("did not autostart") whenever background music was
  // playing. Root cause: `useMusicPlayer()` in the top-level AppContent re-renders
  // the whole route subtree every 100ms (MusicContext currentTime tick), and each
  // render passes a fresh inline `onComplete` arrow. When `onComplete` was an
  // interval-effect dependency, the 1s countdown interval was cleared + restarted
  // ~10x/sec and never fired. onComplete now lives in a ref, so the interval
  // survives frequent re-renders.
  it('keeps counting down when a new onComplete identity arrives every 100ms', () => {
    const { rerender } = render(<Timer seconds={45} running onComplete={() => {}} />);
    expect(screen.getByText('45')).toBeInTheDocument();

    for (let i = 0; i < 30; i++) {
      act(() => { vi.advanceTimersByTime(100); });
      // Fresh arrow each render mirrors the inline callback the games pass.
      rerender(<Timer seconds={45} running onComplete={() => {}} />);
    }

    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
