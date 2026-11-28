import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import FilmStripeForm from '@/components/backend/questions/FilmStripeForm';
import type { FilmStripeQuestion } from '@/types/config';
import * as backendApi from '@/services/backendApi';
import type { FilmStripePrepareEvent, SystemStatusResponse } from '@/services/backendApi';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

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
    // A run that completes ends its stream with `done`.
    vi.mocked(backendApi.prepareFilmStripes).mockReset().mockImplementation(async (_paths, onEvent) => {
      onEvent?.({ percent: 100, done: true, failures: 0 });
    });
    __clearWsCacheForTests();
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
    expect(paths).toEqual(['Dune.m4v']);
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

  it('expands the failed films and jumps to the question of one', async () => {
    vi.mocked(backendApi.prepareFilmStripes).mockImplementation(async (_paths, onEvent) => {
      onEvent?.({ path: 'Dune.m4v', itemError: 'Video nicht erreichbar' });
      onEvent?.({ path: 'Gone.m4v', itemError: 'Kaputt' });
      onEvent?.({ percent: 100, done: true, failures: 2 });
    });
    const { container } = render(<FilmStripeForm questions={[nemo, { ...dune, answer: 'Dune (2021)' }]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Streifen berechnen' }));

    const toggle = await screen.findByRole('button', { name: /2 fehlgeschlagen/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Fehlgeschlagene Filme' })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Fehlgeschlagene Filme' });
    expect(list).toHaveTextContent('Dune (2021)Video nicht erreichbar');
    // A film no question uses any more is listed, but not as a link.
    expect(list).toHaveTextContent('GoneKaputt');
    expect(screen.queryByRole('button', { name: 'Gone' })).not.toBeInTheDocument();

    const block = container.querySelector<HTMLElement>('.question-block[data-question-index="1"]')!;
    const scrollIntoView = vi.fn();
    block.scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByRole('button', { name: 'Dune (2021)' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(block).toHaveClass('question-block--highlight');

    fireEvent.click(toggle);
    expect(screen.queryByRole('list', { name: 'Fehlgeschlagene Filme' })).not.toBeInTheDocument();
  });

  it('shows the run: film x/y, the current film, elapsed time and the state of each question', async () => {
    vi.mocked(backendApi.getFilmStripeStatus).mockResolvedValue({ 'Findet Nemo.m4v': MISSING, 'Dune.m4v': MISSING });
    let emit: (ev: FilmStripePrepareEvent) => void = () => {};
    let finish: () => void = () => {};
    vi.mocked(backendApi.prepareFilmStripes).mockImplementation((_paths, onEvent) => new Promise<void>(resolve => {
      emit = ev => act(() => onEvent?.(ev));
      finish = resolve;
    }));
    const { container } = render(<FilmStripeForm questions={[nemo, dune]} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('0/2 Filme vorbereitet')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Streifen berechnen' }));
    await waitFor(() => expect(backendApi.prepareFilmStripes).toHaveBeenCalledTimes(1));
    emit({ taskId: 'bg-1' });
    emit({ path: 'Findet Nemo.m4v', percent: 40 });

    const runStatus = screen.getByTestId('film-stripe-run-status');
    expect(runStatus).toHaveTextContent('Film 1/2');
    expect(runStatus).toHaveTextContent('Findet Nemo · 40 %');
    expect(runStatus).toHaveTextContent('20 % gesamt');
    expect(screen.getByRole('progressbar', { name: 'Fortschritt Filmstreifen' })).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByText('⏳ wird berechnet · 40 %')).toBeInTheDocument();
    expect(screen.getByText('in Warteschlange')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Berechnet/ })).toBeDisabled();

    // A finished film's stripe is reloaded at once, not after the batch.
    vi.mocked(backendApi.getFilmStripeStatus).mockClear().mockResolvedValue({ 'Findet Nemo.m4v': READY });
    emit({ path: 'Findet Nemo.m4v', ready: true });
    await waitFor(() => expect(backendApi.getFilmStripeStatus).toHaveBeenCalledWith(['Findet Nemo.m4v']));
    await waitFor(() => expect(container.querySelectorAll('.film-stripe-bar')).toHaveLength(1));
    expect(screen.getByTestId('film-stripe-run-status')).toHaveTextContent('Film 2/2');
    expect(screen.getByTestId('film-stripe-run-status')).toHaveTextContent('Dune');

    emit({ path: 'Dune.m4v', itemError: 'Video nicht erreichbar' });
    emit({ percent: 100, done: true, failures: 1 });
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByText('⚠ 1 fehlgeschlagen')).toBeInTheDocument());
    expect(screen.getByText('⚠ Streifen fehlgeschlagen: Video nicht erreichbar')).toBeInTheDocument();
  });

  it('follows a run started elsewhere over the system-status channel', async () => {
    vi.mocked(backendApi.getFilmStripeStatus).mockResolvedValue({ 'Findet Nemo.m4v': MISSING, 'Dune.m4v': MISSING });
    render(<FilmStripeForm questions={[nemo, dune]} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('0/2 Filme vorbereitet')).toBeInTheDocument());

    const status = (filmStripe: NonNullable<NonNullable<SystemStatusResponse['processes']['backgroundTasks'][number]['meta']>['filmStripe']> | null) => ({
      processes: {
        ytDownloads: [],
        backgroundTasks: filmStripe ? [{
          id: 'bg-7', type: 'film-stripe', label: 'Filmstreifen berechnen: 2 Filme', status: 'running', elapsed: 60,
          runningAt: Date.now() - 60_000, meta: { filmStripe },
        }] : [],
      },
    });

    vi.mocked(backendApi.getFilmStripeStatus).mockClear();
    act(() => __emitChannelForTests('system-status', status({ paths: ['Findet Nemo.m4v', 'Dune.m4v'], done: 1, failed: [], current: 'Dune.m4v', currentPercent: 50 })));
    const runStatus = screen.getByTestId('film-stripe-run-status');
    expect(runStatus).toHaveTextContent('Film 2/2');
    expect(runStatus).toHaveTextContent('Dune · 50 %');
    // 1.5 films in 60 s → 0.5 left ≈ 20 s.
    expect(runStatus).toHaveTextContent(/noch ca\. 2\ds/);
    expect(screen.getByRole('button', { name: /Berechnet/ })).toBeDisabled();
    // The film that finished before this form saw the run is reloaded.
    await waitFor(() => expect(backendApi.getFilmStripeStatus).toHaveBeenCalledWith(['Findet Nemo.m4v']));

    act(() => __emitChannelForTests('system-status', status(null)));
    expect(screen.queryByTestId('film-stripe-run-status')).not.toBeInTheDocument();
    await waitFor(() => expect(backendApi.getFilmStripeStatus).toHaveBeenCalledWith(['Findet Nemo.m4v', 'Dune.m4v']));
  });

  it('ignores the system-status copy of its own run', async () => {
    let finish: () => void = () => {};
    vi.mocked(backendApi.prepareFilmStripes).mockImplementation((_paths, onEvent) => new Promise<void>(resolve => {
      onEvent?.({ taskId: 'bg-3' });
      finish = () => { onEvent?.({ percent: 100, done: true, failures: 0 }); resolve(); };
    }));
    render(<FilmStripeForm questions={[dune]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Streifen berechnen' }));
    await waitFor(() => expect(backendApi.prepareFilmStripes).toHaveBeenCalledTimes(1));
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByText('✅ Streifen berechnet')).toBeInTheDocument());

    // A late snapshot that still shows the task running must not bring the bar back.
    act(() => __emitChannelForTests('system-status', { processes: { ytDownloads: [], backgroundTasks: [{
      id: 'bg-3', type: 'film-stripe', label: '', status: 'running', elapsed: 5,
      meta: { filmStripe: { paths: ['Dune.m4v'], done: 0, failed: [] } },
    }] } }));
    expect(screen.queryByTestId('film-stripe-run-status')).not.toBeInTheDocument();
  });

  it('reports a run whose stream ended early as aborted, not as done', async () => {
    vi.mocked(backendApi.prepareFilmStripes).mockImplementation(async (_paths, onEvent) => {
      onEvent?.({ taskId: 'bg-4' });
      onEvent?.({ path: 'Dune.m4v', percent: 30 });
      // Server restarted: the stream closes without `done`.
    });
    render(<FilmStripeForm questions={[dune]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Streifen berechnen' }));
    await waitFor(() => expect(screen.getByText(/Abgebrochen/)).toBeInTheDocument());
    expect(screen.queryByText('✅ Streifen berechnet')).not.toBeInTheDocument();
  });

  it('edits the answer of a question', () => {
    const onChange = vi.fn();
    render(<FilmStripeForm questions={[nemo]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Findet Nemo'), { target: { value: 'Nemo' } });
    expect(onChange).toHaveBeenCalledWith([{ video: '/videos/Findet Nemo.m4v', answer: 'Nemo' }]);
  });
});
