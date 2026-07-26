import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NasSyncConflictsCard from '@/components/backend/NasSyncConflictsCard';
import type { NasSyncConflictEntry } from '@/services/backendApi';

const CONFLICTS: NasSyncConflictEntry[] = [
  { rel: 'images/Tiere/Fuchs.jpg', action: 'delete-local', folder: 'images', reason: 'loss-ratio-veto', lossRatio: 0.123, runId: 'r', detectedAt: 0, lastSeenAt: 0 },
  { rel: 'images/Tiere/Dachs.jpg', action: 'delete-local', folder: 'images', reason: 'loss-ratio-veto', lossRatio: 0.123, runId: 'r', detectedAt: 0, lastSeenAt: 0 },
  { rel: 'audio/Intro.mp3', action: 'delete-nas', folder: 'audio', reason: 'bulk-cap', runId: 'r', detectedAt: 0, lastSeenAt: 0 },
];

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  confirmSpy.mockRestore();
  vi.clearAllMocks();
});

describe('NasSyncConflictsCard', () => {
  it('shows "Keine Konflikte" when there are none', () => {
    render(<NasSyncConflictsCard conflicts={[]} nasReachable onResolve={vi.fn()} />);
    expect(screen.getByText(/Keine Konflikte/)).toBeInTheDocument();
  });

  it('groups conflicts by folder + reason and shows the loss ratio', () => {
    render(<NasSyncConflictsCard conflicts={CONFLICTS} nasReachable onResolve={vi.fn()} />);
    // images/ group: 2 files, loss %
    expect(screen.getByText(/images\//)).toBeInTheDocument();
    expect(screen.getByText(/2 Dateien fehlen auf NAS/)).toBeInTheDocument();
    expect(screen.getByText(/12,3 % Verlust/)).toBeInTheDocument();
    // audio/ bulk-cap group
    expect(screen.getByText(/Massenlöschung blockiert/)).toBeInTheDocument();
  });

  it('restores a whole group without a confirm prompt', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<NasSyncConflictsCard conflicts={CONFLICTS} nasReachable onResolve={onResolve} />);
    // Groups sort alphabetically by folder: [audio, images]. Target the images group.
    const buttons = screen.getAllByRole('button', { name: /Alle wiederherstellen/ });
    await userEvent.click(buttons[1]!);
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(onResolve).toHaveBeenCalledWith(
      ['images/Tiere/Fuchs.jpg', 'images/Tiere/Dachs.jpg'],
      'restore',
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('confirms before deleting a whole group and passes resolution "delete"', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<NasSyncConflictsCard conflicts={CONFLICTS} nasReachable onResolve={onResolve} />);
    const buttons = screen.getAllByRole('button', { name: /Alle löschen/ });
    await userEvent.click(buttons[1]!); // images group
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onResolve).toHaveBeenCalledWith(
      ['images/Tiere/Fuchs.jpg', 'images/Tiere/Dachs.jpg'],
      'delete',
    );
  });

  it('does not resolve when the delete confirm is cancelled', async () => {
    confirmSpy.mockReturnValue(false);
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<NasSyncConflictsCard conflicts={CONFLICTS} nasReachable onResolve={onResolve} />);
    await userEvent.click(screen.getAllByRole('button', { name: /Alle löschen/ })[0]!);
    expect(confirmSpy).toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('resolves a single file after expanding the group', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<NasSyncConflictsCard conflicts={CONFLICTS} nasReachable onResolve={onResolve} />);
    // Expand the images group (its header button toggles it).
    await userEvent.click(screen.getByRole('button', { name: /images\// }));
    // The per-file relative path is shown (folder prefix stripped).
    expect(screen.getByText('Tiere/Fuchs.jpg')).toBeInTheDocument();
    // Click the single-file restore (↻) button in that row.
    const restoreButtons = screen.getAllByRole('button', { name: '↻' });
    await userEvent.click(restoreButtons[0]!);
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(onResolve).toHaveBeenCalledWith(['images/Tiere/Fuchs.jpg'], 'restore');
  });

  it('disables all resolve actions when the NAS is unreachable', () => {
    render(<NasSyncConflictsCard conflicts={CONFLICTS} nasReachable={false} onResolve={vi.fn()} />);
    expect(screen.getByText(/NAS nicht erreichbar/)).toBeInTheDocument();
    for (const btn of screen.getAllByRole('button', { name: /Alle wiederherstellen|Alle löschen/ })) {
      expect(btn).toBeDisabled();
    }
  });
});
