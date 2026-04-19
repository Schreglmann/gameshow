import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import { __clearWsCacheForTests, __emitChannelForTests } from '@/services/useBackendSocket';
import { setInactiveShowTab } from '@/services/showPresenceState';

describe('useGamemasterCommandListener — inactive show gating', () => {
  beforeEach(() => {
    __clearWsCacheForTests();
    setInactiveShowTab(false);
  });

  it('invokes the handler when the tab is active', () => {
    const handler = vi.fn();
    renderHook(() => useGamemasterCommandListener(handler));
    __emitChannelForTests('gamemaster-command', { controlId: 'nav-forward', timestamp: Date.now() });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('drops commands when the tab is an inactive show', () => {
    const handler = vi.fn();
    renderHook(() => useGamemasterCommandListener(handler));
    setInactiveShowTab(true);
    __emitChannelForTests('gamemaster-command', { controlId: 'nav-forward', timestamp: Date.now() });
    expect(handler).not.toHaveBeenCalled();
  });

  it('resumes processing commands after inactive → active transition', () => {
    const handler = vi.fn();
    renderHook(() => useGamemasterCommandListener(handler));
    setInactiveShowTab(true);
    __emitChannelForTests('gamemaster-command', { controlId: 'nav-forward', timestamp: 1 });
    expect(handler).not.toHaveBeenCalled();

    setInactiveShowTab(false); // claim / auto-promote
    __emitChannelForTests('gamemaster-command', { controlId: 'nav-forward', timestamp: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
