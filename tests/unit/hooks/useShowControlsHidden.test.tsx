import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShowControlsHidden, SHOW_CONTROLS_HIDDEN_CLASS } from '@/hooks/useShowControlsHidden';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

const hasClass = () => document.documentElement.classList.contains(SHOW_CONTROLS_HIDDEN_CLASS);
const setGmConnected = (connected: boolean) => {
  act(() => { __emitChannelForTests('gm-presence', { connected }); });
};

describe('useShowControlsHidden', () => {
  beforeEach(() => {
    __clearWsCacheForTests();
    document.documentElement.classList.remove(SHOW_CONTROLS_HIDDEN_CLASS);
    // The hiding only applies while a gamemaster is connected; most cases assume one.
    setGmConnected(true);
  });

  it('leaves the buttons visible until the gamemaster hides them', () => {
    renderHook(() => useShowControlsHidden());
    expect(hasClass()).toBe(false);
  });

  it('sets and clears the <html> class as the channel changes', () => {
    renderHook(() => useShowControlsHidden());
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: true }); });
    expect(hasClass()).toBe(true);
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: false }); });
    expect(hasClass()).toBe(false);
  });

  it('picks up a value cached before it mounted (show reload)', () => {
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: true }); });
    renderHook(() => useShowControlsHidden());
    expect(hasClass()).toBe(true);
  });

  it('never sets the class while disabled (theme showcase)', () => {
    const { rerender } = renderHook(({ enabled }) => useShowControlsHidden(enabled), {
      initialProps: { enabled: false },
    });
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: true }); });
    expect(hasClass()).toBe(false);
    rerender({ enabled: true });
    expect(hasClass()).toBe(true);
  });

  it('removes the class on unmount', () => {
    const { unmount } = renderHook(() => useShowControlsHidden());
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: true }); });
    unmount();
    expect(hasClass()).toBe(false);
  });

  it('keeps the buttons visible while no gamemaster is connected', () => {
    setGmConnected(false);
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: true }); });
    renderHook(() => useShowControlsHidden());
    expect(hasClass()).toBe(false);
  });

  it('brings the buttons back when the last gamemaster leaves and hides them on reconnect', () => {
    renderHook(() => useShowControlsHidden());
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: true }); });
    expect(hasClass()).toBe(true);
    setGmConnected(false);
    expect(hasClass()).toBe(false);
    setGmConnected(true);
    expect(hasClass()).toBe(true);
  });
});
