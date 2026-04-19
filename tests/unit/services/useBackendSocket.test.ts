import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { __clearWsCacheForTests, __emitChannelForTests, useWsChannel } from '@/services/useBackendSocket';

describe('useBackendSocket — late-subscriber cache replay', () => {
  beforeEach(() => {
    __clearWsCacheForTests();
  });

  it('delivers the last cached value to a listener that subscribes after the message arrived', () => {
    const payload = { gameTitle: 'Quiz', answer: 'Rom' };
    // Simulate the server pushing cached state BEFORE any React subscriber mounts.
    __emitChannelForTests('gamemaster-answer', payload);

    // Now a late subscriber mounts via the React hook.
    const handler = vi.fn();
    renderHook(() => useWsChannel('gamemaster-answer', handler));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('also delivers subsequent messages to the late subscriber', () => {
    const first = { answer: 'Rom' };
    const second = { answer: 'Paris' };
    __emitChannelForTests('gamemaster-answer', first);

    const handler = vi.fn();
    renderHook(() => useWsChannel('gamemaster-answer', handler));
    handler.mockClear();

    __emitChannelForTests('gamemaster-answer', second);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(second);
  });
});
