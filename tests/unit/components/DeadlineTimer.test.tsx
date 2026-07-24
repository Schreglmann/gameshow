import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DeadlineTimer from '@/components/common/DeadlineTimer';
import { playTimerTick, playTimerEnd } from '@/utils/timerSound';

vi.mock('@/utils/timerSound', () => ({
  playTimerTick: vi.fn(),
  playTimerEnd: vi.fn(),
}));

describe('DeadlineTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(playTimerTick).mockClear();
    vi.mocked(playTimerEnd).mockClear();
    // Audio is unavailable in jsdom; stub so the buzzer never throws.
    vi.spyOn(window, 'Audio' as never).mockImplementation((() => ({ play: () => Promise.resolve() })) as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when there is no deadline', () => {
    const { container } = render(<DeadlineTimer endsAt={null} totalSeconds={30} />);
    expect(container.querySelector('.deadline-timer')).toBeNull();
  });

  it('shows the remaining whole seconds from an absolute deadline', () => {
    const now = Date.now();
    render(<DeadlineTimer endsAt={now + 30000} totalSeconds={30} />);
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('counts down as wall-clock time advances', () => {
    const now = Date.now();
    render(<DeadlineTimer endsAt={now + 30000} totalSeconds={30} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('freezes while paused and resumes counting when unpaused', () => {
    const now = Date.now();
    const { rerender } = render(<DeadlineTimer endsAt={now + 30000} totalSeconds={30} paused={false} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText('26')).toBeInTheDocument();
    rerender(<DeadlineTimer endsAt={now + 30000} totalSeconds={30} paused />);
    act(() => { vi.advanceTimersByTime(5000); });
    // Still frozen at 26 — paused timers don't decrement.
    expect(screen.getByText('26')).toBeInTheDocument();
  });

  it('fires onComplete once and shows the expired badge at zero', () => {
    const now = Date.now();
    const onComplete = vi.fn();
    render(<DeadlineTimer endsAt={now + 3000} totalSeconds={3} onComplete={onComplete} />);
    act(() => { vi.advanceTimersByTime(3500); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Zeit abgelaufen!')).toBeInTheDocument();
    // No further calls as time continues.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('re-arms onComplete when a new deadline starts (endsAt moves forward)', () => {
    const now = Date.now();
    const onComplete = vi.fn();
    const { rerender } = render(<DeadlineTimer endsAt={now + 2000} totalSeconds={2} onComplete={onComplete} />);
    act(() => { vi.advanceTimersByTime(2500); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    const later = Date.now();
    rerender(<DeadlineTimer endsAt={later + 2000} totalSeconds={2} onComplete={onComplete} />);
    act(() => { vi.advanceTimersByTime(2500); });
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('ticks once per second by default', () => {
    const now = Date.now();
    render(<DeadlineTimer endsAt={now + 5000} totalSeconds={5} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(playTimerTick).toHaveBeenCalled();
  });

  it('muteTicks suppresses the per-second tick but NOT the finish motif', () => {
    const now = Date.now();
    render(<DeadlineTimer endsAt={now + 3000} totalSeconds={3} muteTicks onComplete={() => {}} />);
    act(() => { vi.advanceTimersByTime(3500); });
    expect(playTimerTick).not.toHaveBeenCalled();
    expect(playTimerEnd).toHaveBeenCalledTimes(1);
  });
});
