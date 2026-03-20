import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import StatusMessage from '@/components/backend/StatusMessage';

describe('StatusMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when message is null', () => {
    const { container } = render(<StatusMessage message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a success toast when message type is success', () => {
    render(<StatusMessage message={{ type: 'success', text: 'Saved!' }} />);
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('renders an error toast when message type is error', () => {
    render(<StatusMessage message={{ type: 'error', text: 'Something went wrong' }} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('applies success class to success toast', () => {
    render(<StatusMessage message={{ type: 'success', text: 'Done' }} />);
    const toast = screen.getByText('Done').closest('.be-toast');
    expect(toast).toHaveClass('be-toast-success');
  });

  it('applies error class to error toast', () => {
    render(<StatusMessage message={{ type: 'error', text: 'Error' }} />);
    const toast = screen.getByText('Error').closest('.be-toast');
    expect(toast).toHaveClass('be-toast-error');
  });

  it('toast exits after 2200ms', () => {
    render(<StatusMessage message={{ type: 'success', text: 'Exiting' }} />);
    expect(screen.getByText('Exiting')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2200); });
    const toast = screen.getByText('Exiting').closest('.be-toast');
    expect(toast).toHaveClass('be-toast-exit');
  });

  it('toast is removed from DOM after 2500ms', () => {
    render(<StatusMessage message={{ type: 'success', text: 'Gone' }} />);
    expect(screen.getByText('Gone')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
  });

  it('stacks multiple toasts when message prop changes', () => {
    const { rerender } = render(<StatusMessage message={{ type: 'success', text: 'First' }} />);
    rerender(<StatusMessage message={{ type: 'error', text: 'Second' }} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('renders toast in document.body via portal', () => {
    render(<StatusMessage message={{ type: 'success', text: 'Portal toast' }} />);
    const container = document.querySelector('.be-toast-container');
    expect(container).not.toBeNull();
    expect(document.body.contains(container)).toBe(true);
  });
});
