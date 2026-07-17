import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NasPathBrowser from '@/components/backend/NasPathBrowser';
import * as backendApi from '@/services/backendApi';

vi.mock('@/services/backendApi', async (importOriginal) => {
  const actual = await importOriginal<typeof backendApi>();
  return {
    ...actual,
    listReferenceRoots: vi.fn(),
    browseReferencePaths: vi.fn(),
  };
});

const listRoots = vi.mocked(backendApi.listReferenceRoots);
const browse = vi.mocked(backendApi.browseReferencePaths);

beforeEach(() => {
  listRoots.mockResolvedValue([
    { path: '/Volumes', reachable: true },
    { path: '/Users/me', reachable: true, label: 'Home' },
  ]);
  browse.mockImplementation(async (p: string) => {
    if (p === '/Volumes') {
      return { path: '/Volumes', parent: null, entries: [
        { name: 'NAS', kind: 'dir' as const },
        { name: 'note.txt', kind: 'file' as const, size: 10 },
      ] };
    }
    return { path: p, parent: '/Volumes', entries: [] };
  });
});

afterEach(() => { vi.clearAllMocks(); });

describe('NasPathBrowser', () => {
  it('lists reachable roots on open', async () => {
    render(<NasPathBrowser onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(await screen.findByText('/Volumes')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('navigates into a root, shows folders only (not files), and confirms the folder', async () => {
    const onSelect = vi.fn();
    render(<NasPathBrowser onClose={vi.fn()} onSelect={onSelect} />);

    await userEvent.click(await screen.findByText('/Volumes'));

    // Directory entry is shown, file entry is filtered out.
    await waitFor(() => expect(screen.getByText('NAS')).toBeInTheDocument());
    expect(screen.queryByText('note.txt')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Diesen Ordner verwenden' }));
    expect(onSelect).toHaveBeenCalledWith('/Volumes');
  });

  it('opens directly at initialPath when provided', async () => {
    render(<NasPathBrowser initialPath="/Volumes" onClose={vi.fn()} onSelect={vi.fn()} />);
    await waitFor(() => expect(browse).toHaveBeenCalledWith('/Volumes'));
    expect(await screen.findByText('NAS')).toBeInTheDocument();
  });
});
