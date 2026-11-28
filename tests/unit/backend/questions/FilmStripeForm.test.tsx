import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FilmStripeForm from '@/components/backend/questions/FilmStripeForm';
import type { FilmStripeQuestion } from '@/types/config';
import * as backendApi from '@/services/backendApi';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
  getFilmStripeStatus: vi.fn().mockResolvedValue({}),
  prepareFilmStripes: vi.fn().mockResolvedValue(undefined),
}));

const nemo: FilmStripeQuestion = { video: '/videos/Findet Nemo.m4v', answer: 'Findet Nemo' };
const dune: FilmStripeQuestion = { video: '/videos/Dune.m4v', answer: 'Dune' };

const READY = { ready: true, current: true, sourceReachable: true, frames: 48, colors: ['#112233', '#445566'] };
const MISSING = { ready: false, current: false, sourceReachable: true, frames: 0, colors: [] };

describe('FilmStripeForm', () => {
  beforeEach(() => {
    vi.mocked(backendApi.getFilmStripeStatus).mockReset().mockResolvedValue({});
    vi.mocked(backendApi.prepareFilmStripes).mockReset().mockResolvedValue(undefined);
  });

  it('renders empty state with only the ghost row and a disabled compute button', () => {
    render(<FilmStripeForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Streifen berechnen/ })).toBeDisabled();
  });

  it('asks for the status of each distinct video once', async () => {
    render(<FilmStripeForm questions={[nemo, dune, { ...nemo, answer: 'Nemo nochmal' }]} onChange={vi.fn()} />);
    await waitFor(() => expect(backendApi.getFilmStripeStatus).toHaveBeenCalledWith(['Findet Nemo.m4v', 'Dune.m4v']));
  });

  it('shows a stripe preview for a prepared film and a note for one that is not', async () => {
    vi.mocked(backendApi.getFilmStripeStatus).mockResolvedValue({ 'Findet Nemo.m4v': READY, 'Dune.m4v': MISSING });
    const { container } = render(<FilmStripeForm questions={[nemo, dune]} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('1/2 Filme vorbereitet')).toBeInTheDocument());
    expect(container.querySelectorAll('.film-stripe-bar')).toHaveLength(1);
    expect(container.querySelectorAll('.film-stripe-bar__colors rect')).toHaveLength(2);
    expect(screen.getByText(/kein Streifen berechnet/)).toBeInTheDocument();
  });

  it('flags a stripe whose video file changed', async () => {
    vi.mocked(backendApi.getFilmStripeStatus).mockResolvedValue({ 'Findet Nemo.m4v': { ...READY, current: false } });
    render(<FilmStripeForm questions={[nemo]} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Streifen veraltet/)).toBeInTheDocument());
    expect(screen.getByText('0/1 Filme vorbereitet')).toBeInTheDocument();
  });

  it('computes the missing stripes without forcing the ones that exist', async () => {
    vi.mocked(backendApi.getFilmStripeStatus).mockResolvedValue({ 'Findet Nemo.m4v': READY, 'Dune.m4v': MISSING });
    render(<FilmStripeForm questions={[nemo, dune]} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('1/2 Filme vorbereitet')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Streifen berechnen' }));
    await waitFor(() => expect(backendApi.prepareFilmStripes).toHaveBeenCalledTimes(1));
    const [paths, , force] = vi.mocked(backendApi.prepareFilmStripes).mock.calls[0]!;
    expect(paths).toEqual(['Findet Nemo.m4v', 'Dune.m4v']);
    expect(force).toBe(false);
    await waitFor(() => expect(screen.getByText('✅ Streifen berechnet')).toBeInTheDocument());
  });

  it('forces a recompute when every stripe is already current', async () => {
    vi.mocked(backendApi.getFilmStripeStatus).mockResolvedValue({ 'Findet Nemo.m4v': READY });
    render(<FilmStripeForm questions={[nemo]} onChange={vi.fn()} />);
    const button = await screen.findByRole('button', { name: 'Streifen neu berechnen' });
    fireEvent.click(button);
    await waitFor(() => expect(backendApi.prepareFilmStripes).toHaveBeenCalledTimes(1));
    expect(vi.mocked(backendApi.prepareFilmStripes).mock.calls[0]![2]).toBe(true);
  });

  it('reports films that failed', async () => {
    vi.mocked(backendApi.prepareFilmStripes).mockImplementation(async (_paths, onEvent) => {
      onEvent?.({ path: 'Dune.m4v', itemError: 'Video nicht erreichbar' });
      onEvent?.({ percent: 100, done: true, failures: 1 });
    });
    render(<FilmStripeForm questions={[dune]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Streifen berechnen' }));
    await waitFor(() => expect(screen.getByText(/1 fehlgeschlagen/)).toBeInTheDocument());
  });

  it('edits the answer of a question', () => {
    const onChange = vi.fn();
    render(<FilmStripeForm questions={[nemo]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Findet Nemo'), { target: { value: 'Nemo' } });
    expect(onChange).toHaveBeenCalledWith([{ video: '/videos/Findet Nemo.m4v', answer: 'Nemo' }]);
  });
});
