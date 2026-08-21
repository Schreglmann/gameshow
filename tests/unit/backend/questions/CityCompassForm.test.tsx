import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CityCompassForm from '@/components/backend/questions/CityCompassForm';
import type { CityCompassQuestion } from '@/types/config';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const sample: CityCompassQuestion = {
  center: { name: 'Wien', lat: 48.2085, lon: 16.3721, country: 'AT' },
  neighbors: [
    { name: 'Prag', lat: 50.088, lon: 14.4208, country: 'CZ' },
    { name: 'Budapest', lat: 47.4984, lon: 19.0404, country: 'HU' },
    { name: 'Rom', lat: 41.8919, lon: 12.5113, country: 'IT' },
  ],
};

const noop = () => {};

function renderForm(onChange = vi.fn(), questions: CityCompassQuestion[] = [sample]) {
  render(
    <CityCompassForm
      questions={questions}
      onChange={onChange}
      onChangeShowDistances={noop}
      onChangeReveal={noop}
    />,
  );
  return onChange;
}

/**
 * The city dataset loads through a dynamic import, so the search inputs start
 * disabled and carry a loading placeholder. Returns the first question's
 * "add a neighbor" input, which is the second search field on the page (the first
 * one picks the center city).
 */
async function awaitDataset(): Promise<HTMLInputElement> {
  await waitFor(() => {
    const inputs = document.querySelectorAll('.city-search input');
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs[0]).not.toBeDisabled();
  });
  return document.querySelectorAll('.city-search input')[1] as HTMLInputElement;
}

function results() {
  return Array.from(document.querySelectorAll('.city-search-result')).map(el => el.textContent ?? '');
}

function highlightedIndex() {
  return Array.from(document.querySelectorAll('.city-search-result')).findIndex(el =>
    el.classList.contains('highlighted'),
  );
}

describe('CityCompassForm', () => {
  it('waits for the lazily imported dataset before enabling the search', () => {
    renderForm();
    expect(screen.getAllByPlaceholderText('Städte werden geladen…').length).toBeGreaterThan(0);
  });

  it('searches cities by name, preferring a prefix match', async () => {
    renderForm();
    const input = await awaitDataset();
    fireEvent.change(input, { target: { value: 'Wel' } });
    await waitFor(() => expect(results().length).toBeGreaterThan(0));
    expect(results()[0]).toContain('Wellington');
    expect(results().join(' ')).toContain('Wels');
  });

  it('needs two characters before it offers anything', async () => {
    renderForm();
    const input = await awaitDataset();
    fireEvent.change(input, { target: { value: 'W' } });
    expect(results()).toHaveLength(0);
  });

  it('never offers a city the question already uses', async () => {
    renderForm();
    const input = await awaitDataset();
    fireEvent.change(input, { target: { value: 'Budapest' } });
    await waitFor(() => expect(document.querySelectorAll('.city-search').length).toBeGreaterThan(0));
    expect(results()).toHaveLength(0);
  });

  describe('keyboard navigation', () => {
    it('moves the highlight down and up with the arrow keys', async () => {
      renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Wel' } });
      await waitFor(() => expect(results().length).toBeGreaterThan(1));
      expect(highlightedIndex()).toBe(-1);

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(highlightedIndex()).toBe(0);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(highlightedIndex()).toBe(1);
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(highlightedIndex()).toBe(0);
    });

    it('stops at the ends instead of wrapping around', async () => {
      renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Wel' } });
      await waitFor(() => expect(results().length).toBeGreaterThan(1));

      const last = results().length - 1;
      for (let i = 0; i <= last + 2; i += 1) fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(highlightedIndex()).toBe(last);

      for (let i = 0; i <= last + 2; i += 1) fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(highlightedIndex()).toBe(0);
    });

    it('takes ArrowUp from no highlight to the first entry, like the other comboboxes', async () => {
      renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Wel' } });
      await waitFor(() => expect(results().length).toBeGreaterThan(1));

      expect(highlightedIndex()).toBe(-1);
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(highlightedIndex()).toBe(0);
    });

    it('adds the highlighted city on Enter', async () => {
      const onChange = renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Wel' } });
      await waitFor(() => expect(results().length).toBeGreaterThan(0));

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).toHaveBeenCalledTimes(1);
      const neighbors = onChange.mock.calls[0]![0][0].neighbors;
      expect(neighbors).toHaveLength(4);
      expect(neighbors[3]).toMatchObject({ name: 'Wellington', country: 'NZ' });
      expect(typeof neighbors[3].lat).toBe('number');
    });

    it('takes the only match on Enter without arrowing down first', async () => {
      const onChange = renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Zagreb' } });
      await waitFor(() => expect(results()).toHaveLength(1));

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange.mock.calls[0]![0][0].neighbors[3]).toMatchObject({ name: 'Zagreb', country: 'HR' });
    });

    it('does nothing on Enter with several matches and no highlight', async () => {
      const onChange = renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Wel' } });
      await waitFor(() => expect(results().length).toBeGreaterThan(1));

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('closes the list on Escape', async () => {
      renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Wel' } });
      await waitFor(() => expect(results().length).toBeGreaterThan(0));

      fireEvent.keyDown(input, { key: 'Escape' });
      expect(results()).toHaveLength(0);
    });

    it('clears the query and the list after a pick', async () => {
      renderForm();
      const input = await awaitDataset();
      fireEvent.change(input, { target: { value: 'Zagreb' } });
      await waitFor(() => expect(results()).toHaveLength(1));

      fireEvent.keyDown(input, { key: 'Enter' });
      expect((input as HTMLInputElement).value).toBe('');
      expect(results()).toHaveLength(0);
    });
  });

  it('reports distance and bearing for every neighbor', async () => {
    renderForm();
    await awaitDataset();
    const metas = Array.from(document.querySelectorAll('.city-chip__meta')).map(e => e.textContent);
    // Vienna to Budapest: a little over 200 km, east-south-east.
    expect(metas.some(m => m?.includes('210 km') && m.includes('111°'))).toBe(true);
  });

  it('marks a neighbor beyond the 2000 km range', async () => {
    renderForm(vi.fn(), [{
      center: { name: 'Wien', lat: 48.2085, lon: 16.3721 },
      neighbors: [
        { name: 'Prag', lat: 50.088, lon: 14.4208 },
        { name: 'Budapest', lat: 47.4984, lon: 19.0404 },
        { name: 'Tokio', lat: 35.6895, lon: 139.6917 },
      ],
    }]);
    await awaitDataset();
    const warn = document.querySelector('.city-chip__meta--warn');
    expect(warn?.textContent).toContain('über 2000 km');
  });

  it('offers the reveal modes and defaults to all at once', async () => {
    renderForm();
    await awaitDataset();
    const select = document.querySelector('select[aria-label="Aufdecken"]') as HTMLSelectElement;
    expect(select.value).toBe('all');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Alle auf einmal', 'Schrittweise']);
  });

  it('leaves the distance toggle off by default', async () => {
    renderForm();
    await awaitDataset();
    const toggle = document.querySelector('.be-toggle input[type="checkbox"]') as HTMLInputElement;
    expect(toggle).not.toBeChecked();
  });
});
