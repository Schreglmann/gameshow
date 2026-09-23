import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SaveStatusIndicator from '@/components/backend/SaveStatusIndicator';
import { enqueueSave, __resetSaveQueueForTests } from '@/services/saveQueue';

const KEY = 'config';
const settle = () => act(async () => { await Promise.resolve(); });

function httpError(status: number, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status });
}

describe('SaveStatusIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    __resetSaveQueueForTests();
  });

  afterEach(() => {
    __resetSaveQueueForTests();
    vi.useRealTimers();
  });

  it('renders nothing while the queue is idle', () => {
    const { container } = render(<SaveStatusIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing about a fast save, and flashes "Gespeichert" when it lands', async () => {
    render(<SaveStatusIndicator />);
    await act(async () => { enqueueSave(KEY, { v: 1 }, () => Promise.resolve()); });
    // Queued but not yet written — a debounce is not worth announcing.
    expect(screen.queryByText('Speichern…')).not.toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(800); });
    await settle();
    // The request resolved immediately, so "Speichern…" never appeared.
    expect(screen.queryByText('Speichern…')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('✅ Gespeichert!')).toBeInTheDocument());

    // The flash is transient — the box goes away again.
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByText('✅ Gespeichert!')).not.toBeInTheDocument();
  });

  it('announces a save only once it has been on the wire for 500ms', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    render(<SaveStatusIndicator />);
    await act(async () => { enqueueSave(KEY, { v: 1 }, () => gate); });
    await act(async () => { vi.advanceTimersByTime(800); });
    await settle();

    await act(async () => { vi.advanceTimersByTime(499); });
    expect(screen.queryByText('Speichern…')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('Speichern…')).toBeInTheDocument();

    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('✅ Gespeichert!')).toBeInTheDocument());
  });

  it('counts down to the next attempt and retries on demand', async () => {
    const saver = vi.fn().mockRejectedValue(httpError(500));
    render(<SaveStatusIndicator />);
    await act(async () => { enqueueSave(KEY, { v: 1 }, saver); });
    await act(async () => { vi.advanceTimersByTime(800); });
    await settle();

    await waitFor(() =>
      expect(screen.getByText(/Speichern fehlgeschlagen – erneuter Versuch in \d+ s/)).toBeInTheDocument());
    expect(saver).toHaveBeenCalledTimes(1);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Jetzt versuchen' }));
    await settle();
    expect(saver).toHaveBeenCalledTimes(2);
  });

  it('reports a permanent failure with its message and a manual retry', async () => {
    const saver = vi.fn().mockRejectedValue(httpError(400, 'invalid-config'));
    render(<SaveStatusIndicator />);
    await act(async () => { enqueueSave(KEY, { v: 1 }, saver); });
    await act(async () => { vi.advanceTimersByTime(800); });
    await settle();

    await waitFor(() =>
      expect(screen.getByText('❌ Speichern fehlgeschlagen: invalid-config')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('explains an offline hold instead of blaming the save', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<SaveStatusIndicator />);
    await act(async () => {
      enqueueSave(KEY, { v: 1 }, () => Promise.reject(new TypeError('Failed to fetch')));
    });
    await act(async () => { vi.advanceTimersByTime(800); });
    await settle();

    await waitFor(() => expect(screen.getByText(/^Offline –/)).toBeInTheDocument());
    onLine.mockRestore();
  });
});
