import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnswersTab from '@/components/backend/AnswersTab';

const mockFetchSystemStatus = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchSystemStatus: (...args: unknown[]) => mockFetchSystemStatus(...args),
}));

function statusWith(localIps: Array<{ iface: string; address: string }>, port = 3000) {
  // Component only reads server.network — return a minimal shape.
  return { server: { network: { port, localIps } } };
}

describe('AnswersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSystemStatus.mockResolvedValue(statusWith([{ iface: 'en0', address: '192.168.0.42' }]));
  });

  it('renders the fullscreen link to /gamemaster and the QR button', () => {
    render(<AnswersTab />);
    const link = screen.getByRole('link', { name: 'Vollbild öffnen' });
    expect(link).toHaveAttribute('href', '/gamemaster');
    expect(screen.getByRole('button', { name: 'QR-Code' })).toBeInTheDocument();
  });

  it('opens the QR modal with the resolved gamemaster URL when clicked', async () => {
    const user = userEvent.setup();
    render(<AnswersTab />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'QR-Code' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Gamemaster auf anderem Gerät öffnen');
    await waitFor(() =>
      expect(screen.getByText('http://192.168.0.42:3000/gamemaster/')).toBeInTheDocument(),
    );
  });

  it('shows a pill per interface and switches the encoded URL when there are multiple IPs', async () => {
    mockFetchSystemStatus.mockResolvedValue(
      statusWith([
        { iface: 'en0', address: '192.168.0.42' },
        { iface: 'en1', address: '10.0.0.7' },
      ]),
    );
    const user = userEvent.setup();
    render(<AnswersTab />);

    await user.click(screen.getByRole('button', { name: 'QR-Code' }));
    await screen.findByText('http://192.168.0.42:3000/gamemaster/');

    await user.click(screen.getByRole('button', { name: /en1 — 10\.0\.0\.7/ }));
    expect(screen.getByText('http://10.0.0.7:3000/gamemaster/')).toBeInTheDocument();
  });

  it('closes the modal on the × button', async () => {
    const user = userEvent.setup();
    render(<AnswersTab />);

    await user.click(screen.getByRole('button', { name: 'QR-Code' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a fallback message when no local IP is reported', async () => {
    mockFetchSystemStatus.mockResolvedValue(statusWith([]));
    const user = userEvent.setup();
    render(<AnswersTab />);

    await user.click(screen.getByRole('button', { name: 'QR-Code' }));
    // jsdom location host is "localhost" → no usable fallback URL → error message.
    expect(await screen.findByText(/Keine lokale IP gefunden/)).toBeInTheDocument();
  });
});
