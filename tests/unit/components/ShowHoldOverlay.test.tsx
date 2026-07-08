import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ShowHoldOverlay from '@/components/common/ShowHoldOverlay';
import { __emitChannelForTests } from '@/services/useBackendSocket';

describe('ShowHoldOverlay', () => {
  it('renders nothing until a hold is active', () => {
    render(<ShowHoldOverlay />);
    expect(screen.queryByText(/Gleich geht/)).toBeNull();
  });

  it('shows the branded hold (with optional message) when activated, then hides', () => {
    render(<ShowHoldOverlay />);

    act(() => { __emitChannelForTests('show-hold', { active: true, message: 'Kurze Pause' }); });
    expect(screen.getByText(/Gleich geht/)).toBeInTheDocument();
    expect(screen.getByText('Kurze Pause')).toBeInTheDocument();

    act(() => { __emitChannelForTests('show-hold', { active: false }); });
    expect(screen.queryByText(/Gleich geht/)).toBeNull();
  });

  it('renders without a message when none is given', () => {
    render(<ShowHoldOverlay />);
    act(() => { __emitChannelForTests('show-hold', { active: true }); });
    expect(screen.getByText(/Gleich geht/)).toBeInTheDocument();
  });
});
