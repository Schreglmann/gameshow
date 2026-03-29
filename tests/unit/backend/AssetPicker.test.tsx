import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetField } from '@/components/backend/AssetPicker';

const mockFetchAssets = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchAssets: (...args: unknown[]) => mockFetchAssets(...args),
}));

describe('AssetField', () => {
  beforeEach(() => {
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
  });

  it('renders the label', () => {
    render(<AssetField label="Frage-Bild" value={undefined} category="images" onChange={vi.fn()} />);
    expect(screen.getByText('Frage-Bild')).toBeInTheDocument();
  });

  it('renders empty state button when no value', () => {
    render(<AssetField label="Frage-Bild" value={undefined} category="images" onChange={vi.fn()} />);
    expect(screen.getByText(/Frage-Bild auswählen/)).toBeInTheDocument();
  });

  it('uses image icon for image categories', () => {
    render(<AssetField label="Image" value={undefined} category="images" onChange={vi.fn()} />);
    expect(screen.getByText(/🖼️/)).toBeInTheDocument();
  });

  it('uses audio icon for audio categories', () => {
    render(<AssetField label="Audio" value={undefined} category="audio" onChange={vi.fn()} />);
    expect(screen.getByText(/🎵/)).toBeInTheDocument();
  });

  it('renders image preview when value is set (image category)', () => {
    render(<AssetField label="Frage-Bild" value="/images/test.jpg" category="images" onChange={vi.fn()} />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/images/test.jpg');
  });

  it('renders audio player when value is set (audio category)', () => {
    render(<AssetField label="Audio" value="/audio/test.mp3" category="audio" onChange={vi.fn()} />);
    expect(document.querySelector('.mini-player')).not.toBeNull();
  });

  it('renders filename when value is set', () => {
    render(<AssetField label="Frage-Bild" value="/images/test.jpg" category="images" onChange={vi.fn()} />);
    expect(screen.getByText('test.jpg')).toBeInTheDocument();
  });

  it('renders Ändern and remove buttons when value is set', () => {
    render(<AssetField label="Image" value="/images/test.jpg" category="images" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ändern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '✕' })).toBeInTheDocument();
  });

  it('calls onChange with undefined when remove button is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AssetField label="Image" value="/images/test.jpg" category="images" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('opens picker modal when empty button is clicked', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Frage-Bild" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Frage-Bild auswählen/));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Suchen...')).toBeInTheDocument();
    });
  });

  it('opens picker modal when Ändern button is clicked', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Image" value="/images/test.jpg" category="images" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Suchen...')).toBeInTheDocument();
    });
  });

  it('closes picker modal when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Frage-Bild" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Frage-Bild auswählen/));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Suchen...')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByPlaceholderText('Suchen...')).not.toBeInTheDocument();
  });

  it('closes picker modal when overlay is clicked', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Frage-Bild" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Frage-Bild auswählen/));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Suchen...')).toBeInTheDocument();
    });
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) await user.click(overlay);
    expect(screen.queryByPlaceholderText('Suchen...')).not.toBeInTheDocument();
  });

  it('shows loading state in picker modal while fetching', async () => {
    mockFetchAssets.mockReturnValue(new Promise(() => {})); // never resolves
    const user = userEvent.setup();
    render(<AssetField label="Image" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Image auswählen/));
    expect(screen.getByText('Lade Assets...')).toBeInTheDocument();
  });

  it('shows files in picker modal for image category', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg', 'logo.png'], subfolders: [] });
    const user = userEvent.setup();
    render(<AssetField label="Image" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Image auswählen/));
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('logo.png')).toBeInTheDocument();
    });
  });

  it('shows empty state when no files in picker', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Image" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Image auswählen/));
    await waitFor(() => {
      expect(screen.getByText('Keine Bilder')).toBeInTheDocument();
    });
  });

  it('calls onChange with selected URL when image is picked', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AssetField label="Image" value={undefined} category="images" onChange={onChange} />);
    await user.click(screen.getByText(/Image auswählen/));
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('photo.jpg'));
    expect(onChange).toHaveBeenCalledWith('/images/photo.jpg');
  });

  it('filters files by search query in picker', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg', 'logo.png'], subfolders: [] });
    const user = userEvent.setup();
    render(<AssetField label="Image" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Image auswählen/));
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText('Suchen...'), 'logo');
    expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument();
    expect(screen.getByText('logo.png')).toBeInTheDocument();
  });

  it('shows audio files in audio picker', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['song.mp3', 'jingle.wav'], subfolders: [] });
    const user = userEvent.setup();
    render(<AssetField label="Audio" value={undefined} category="audio" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Audio auswählen/));
    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
      expect(screen.getByText('jingle.wav')).toBeInTheDocument();
    });
  });

  it('shows empty state for audio when no files', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Audio" value={undefined} category="audio" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Audio auswählen/));
    await waitFor(() => {
      expect(screen.getByText('Keine Dateien')).toBeInTheDocument();
    });
  });

  it('shows category name in picker modal header', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Image" value={undefined} category="images" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Image auswählen/));
    await waitFor(() => {
      expect(screen.getByText('images')).toBeInTheDocument();
    });
  });

  it('shows audio-guess files as folder/file pairs', async () => {
    mockFetchAssets.mockResolvedValue({
      files: [],
      subfolders: [
        { name: 'Beatles', files: ['yesterday.mp3'] },
      ],
    });
    const user = userEvent.setup();
    render(<AssetField label="Audio Guess" value={undefined} category="audio-guess" onChange={vi.fn()} />);
    await user.click(screen.getByText(/Audio Guess auswählen/));
    await waitFor(() => {
      expect(screen.getByText('Beatles / yesterday.mp3')).toBeInTheDocument();
    });
  });
});
