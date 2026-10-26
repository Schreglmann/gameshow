import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoGuessForm from '@/components/backend/questions/VideoGuessForm';
import type { VideoGuessQuestion } from '@/types/config';

vi.mock('@/services/backendApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/backendApi')>()),
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
  probeVideo: vi.fn().mockResolvedValue({ audioTracks: [] }),
  warmupSdr: vi.fn().mockResolvedValue(undefined),
  checkSdrCache: vi.fn().mockResolvedValue({ cached: false }),
  fetchCachedTracks: vi.fn().mockResolvedValue([]),
  fetchSystemStatus: vi.fn().mockResolvedValue({}),
}));

const q: VideoGuessQuestion = { video: '', answer: 'Titanic' };

describe('VideoGuessForm gmInfo', () => {
  it('writes gmInfo when typing into the GM field', () => {
    const onChange = vi.fn();
    render(<VideoGuessForm questions={[q]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Nur für den Gamemaster sichtbar/), { target: { value: 'Regie: Cameron' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ answer: 'Titanic', gmInfo: 'Regie: Cameron' })]);
  });
});
