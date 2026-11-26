import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetField, PickerModal } from '@/components/backend/AssetPicker';

const mockFetchAssets = vi.fn();
const mockDownloadImageFromUrl = vi.fn();
const mockSearchImages = vi.fn();
const mockSearchYouTube = vi.fn();
const mockUseUpload = vi.fn<() => unknown>(() => null);

vi.mock('@/services/backendApi', () => ({
  fetchAssets: (...args: unknown[]) => mockFetchAssets(...args),
  downloadImageFromUrl: (...args: unknown[]) => mockDownloadImageFromUrl(...args),
  searchImages: (...args: unknown[]) => mockSearchImages(...args),
  searchYouTube: (...args: unknown[]) => mockSearchYouTube(...args),
}));

// No UploadProvider by default (the picker hides YouTube mode then); the
// YouTube-mode tests return a stub with a controllable startYtDownload.
vi.mock('@/components/backend/UploadContext', () => ({
  useUpload: () => mockUseUpload(),
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

  it('encodes paths with spaces exactly once in the preview src', () => {
    render(<AssetField label="Antwort-Bild" value="/images/Eras Quiz/Taylor Swift.jpg" category="images" onChange={vi.fn()} />);
    const img = document.querySelector('img');
    expect(img).toHaveAttribute('src', '/images/Eras%20Quiz/Taylor%20Swift.jpg');
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

});

describe('PickerModal online mode', () => {
  beforeEach(() => {
    mockFetchAssets.mockResolvedValue({
      files: [],
      subfolders: [{ name: 'Logos', files: [], subfolders: [] }],
    });
    mockSearchImages.mockResolvedValue({
      results: [
        { url: 'https://a/big.jpg', thumbnailUrl: 'https://a/t.jpg', width: 1920, height: 1080, source: 'ddg', title: 'a' },
      ],
      partial: false,
      page: 1,
      hasMore: false,
    });
    mockDownloadImageFromUrl.mockReset();
  });

  it('does not render the DAM/Online toggle for non-image categories', async () => {
    mockFetchAssets.mockResolvedValueOnce({ files: [], subfolders: [] });
    render(<PickerModal category="audio" onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByPlaceholderText('Suchen...')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '🌐 Online' })).not.toBeInTheDocument();
  });

  it('does not render the DAM/Online toggle in multi-select mode', async () => {
    render(<PickerModal category="images" onSelect={vi.fn()} onClose={vi.fn()} multiSelect onMultiSelect={vi.fn()} />);
    await waitFor(() => expect(screen.queryByPlaceholderText('Suchen...')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '🌐 Online' })).not.toBeInTheDocument();
  });

  it('switches to online mode and renders the search panel + subfolder dropdown', async () => {
    const user = userEvent.setup();
    render(<PickerModal category="images" onSelect={vi.fn()} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '🌐 Online' }));
    expect(screen.getByPlaceholderText('Suchbegriff')).toBeInTheDocument();
    expect(screen.getByLabelText(/Speichern in:/i)).toBeInTheDocument();
  });

  it('downloads with desiredName in Title Case and resolves the picker', async () => {
    mockDownloadImageFromUrl.mockResolvedValue('Matthew Mercer.jpg');
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PickerModal category="images" onSelect={onSelect} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '🌐 Online' }));

    const searchInput = screen.getByPlaceholderText('Suchbegriff');
    await user.type(searchInput, 'matthew mercer');
    await user.click(screen.getByRole('button', { name: /🔍 Suchen/i }));

    // Click a candidate to *select* it, then confirm via the Herunterladen button.
    await waitFor(() => expect(screen.getByTitle('a')).toBeInTheDocument());
    await user.click(screen.getByTitle('a'));
    await user.click(await screen.findByRole('button', { name: /✓ Herunterladen/i }));

    await waitFor(() => expect(mockDownloadImageFromUrl).toHaveBeenCalledTimes(1));
    expect(mockDownloadImageFromUrl).toHaveBeenCalledWith('images', 'https://a/big.jpg', undefined, 'Matthew Mercer');
    expect(onSelect).toHaveBeenCalledWith('/images/Matthew Mercer.jpg');
  });

  it('uses the selected subfolder for download and result path', async () => {
    mockDownloadImageFromUrl.mockResolvedValue('Foo.jpg');
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PickerModal category="images" onSelect={onSelect} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '🌐 Online' }));

    const folderSelect = screen.getByLabelText(/Speichern in:/i) as HTMLSelectElement;
    await user.selectOptions(folderSelect, 'Logos');

    await user.type(screen.getByPlaceholderText('Suchbegriff'), 'foo');
    await user.click(screen.getByRole('button', { name: /🔍 Suchen/i }));
    await waitFor(() => expect(screen.getByTitle('a')).toBeInTheDocument());
    await user.click(screen.getByTitle('a'));
    await user.click(await screen.findByRole('button', { name: /✓ Herunterladen/i }));

    await waitFor(() => expect(mockDownloadImageFromUrl).toHaveBeenCalledTimes(1));
    expect(mockDownloadImageFromUrl).toHaveBeenCalledWith('images', 'https://a/big.jpg', 'Logos', 'Foo');
    expect(onSelect).toHaveBeenCalledWith('/images/Logos/Foo.jpg');
  });

  it('keeps the modal open and shows an error banner when download fails', async () => {
    mockDownloadImageFromUrl.mockRejectedValue(new Error('boom'));
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PickerModal category="images" onSelect={onSelect} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '🌐 Online' }));

    await user.type(screen.getByPlaceholderText('Suchbegriff'), 'foo');
    await user.click(screen.getByRole('button', { name: /🔍 Suchen/i }));
    await waitFor(() => expect(screen.getByTitle('a')).toBeInTheDocument());
    await user.click(screen.getByTitle('a'));
    await user.click(await screen.findByRole('button', { name: /✓ Herunterladen/i }));

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('PickerModal YouTube mode', () => {
  type StartArgs = [
    category: string,
    url: string,
    subfolder: string | undefined,
    onDone: (fileName: string) => void,
    playlist: boolean | undefined,
    onError: (message: string) => void,
  ];
  const mockStartYtDownload = vi.fn<(...args: StartArgs) => void>();
  const lastStart = () => mockStartYtDownload.mock.calls.at(-1)!;

  const VIDEO = {
    id: 'dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channel: 'Rick Astley',
    duration: 213,
  };

  beforeEach(() => {
    mockStartYtDownload.mockReset();
    mockUseUpload.mockReturnValue({ startYtDownload: mockStartYtDownload });
    mockFetchAssets.mockResolvedValue({
      files: [],
      subfolders: [{ name: 'Songs', files: [], subfolders: [] }],
    });
    mockSearchYouTube.mockResolvedValue({ results: [VIDEO], page: 1, hasMore: false });
  });

  afterEach(() => {
    mockUseUpload.mockReturnValue(null);
  });

  async function openYouTubeMode(category: 'audio' | 'videos' = 'audio', onSelect = vi.fn()) {
    const user = userEvent.setup();
    const view = render(<PickerModal category={category} onSelect={onSelect} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '▶ YouTube' }));
    return { user, onSelect, ...view };
  }

  async function searchAndPick(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText('YouTube durchsuchen'), 'rick');
    await user.click(screen.getByRole('button', { name: /🔍 Suchen/i }));
    await user.click(await screen.findByTitle(VIDEO.title));
  }

  it.each(['audio', 'videos'] as const)('shows the DAM/YouTube toggle for %s', async (category) => {
    render(<PickerModal category={category} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '▶ YouTube' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '🌐 Online' })).not.toBeInTheDocument();
  });

  it.each(['images', 'background-music'] as const)('does not show the YouTube toggle for %s', async (category) => {
    render(<PickerModal category={category} onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByPlaceholderText('Suchen...')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '▶ YouTube' })).not.toBeInTheDocument();
  });

  it('does not show the YouTube toggle in multi-select mode', async () => {
    render(<PickerModal category="audio" onSelect={vi.fn()} onClose={vi.fn()} multiSelect onMultiSelect={vi.fn()} />);
    await waitFor(() => expect(screen.queryByPlaceholderText('Suchen...')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '▶ YouTube' })).not.toBeInTheDocument();
  });

  it('does not show the YouTube toggle without an UploadProvider', async () => {
    mockUseUpload.mockReturnValue(null);
    render(<PickerModal category="audio" onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByPlaceholderText('Suchen...')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '▶ YouTube' })).not.toBeInTheDocument();
  });

  it('hides the DAM-only controls and shows the folder dropdown and URL row', async () => {
    await openYouTubeMode();
    expect(screen.queryByRole('button', { name: 'Hochladen' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Speichern in:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/URL einfügen:/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('YouTube durchsuchen')).toBeInTheDocument();
  });

  it('selecting a result shows the embedded preview; selecting it again removes it', async () => {
    const { user } = await openYouTubeMode();
    await searchAndPick(user);

    const frame = screen.getByTitle(`YouTube-Vorschau: ${VIDEO.title}`);
    expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
    // YouTube refuses embeds without a referrer (error 153).
    expect(frame.getAttribute('referrerpolicy')).toBeNull();
    expect(screen.getByRole('link', { name: /Auf YouTube öffnen/ })).toHaveAttribute('href', VIDEO.url);
    expect(screen.getByText('Rick Astley · 3:33')).toBeInTheDocument();

    await user.click(screen.getByTitle(VIDEO.title));
    expect(screen.queryByTitle(`YouTube-Vorschau: ${VIDEO.title}`)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /✓ Herunterladen/ })).not.toBeInTheDocument();
  });

  it('the ✕ in the preview closes it and deselects the video', async () => {
    const { user, onSelect } = await openYouTubeMode();
    await searchAndPick(user);

    await user.click(screen.getByRole('button', { name: 'Vorschau schließen' }));
    expect(screen.queryByTitle(`YouTube-Vorschau: ${VIDEO.title}`)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /✓ Herunterladen/ })).not.toBeInTheDocument();
    expect(screen.getByTitle(VIDEO.title)).not.toHaveClass('is-selected');
    // The picker itself stays open.
    expect(screen.getByPlaceholderText('YouTube durchsuchen')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('downloads the picked result into the chosen folder and selects the file', async () => {
    const { user, onSelect } = await openYouTubeMode();
    await user.selectOptions(screen.getByLabelText(/Speichern in:/i), 'Songs');
    await searchAndPick(user);
    await user.click(screen.getByRole('button', { name: /✓ Herunterladen/ }));

    expect(mockStartYtDownload).toHaveBeenCalledTimes(1);
    const [category, url, subfolder, onDone, playlist] = lastStart();
    expect([category, url, subfolder, playlist]).toEqual(['audio', VIDEO.url, 'Songs', undefined]);

    // While downloading: preview gone, button busy, toggle locked.
    expect(screen.queryByTitle(`YouTube-Vorschau: ${VIDEO.title}`)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lädt…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DAM' })).toBeDisabled();

    act(() => onDone('Never Gonna Give You Up.mp3'));
    expect(onSelect).toHaveBeenCalledWith('/audio/Songs/Never Gonna Give You Up.mp3');
  });

  it('previews and downloads a pasted link as its canonical single-video URL', async () => {
    const { user, onSelect } = await openYouTubeMode('videos');
    await user.type(screen.getByLabelText(/URL einfügen:/i), 'https://youtu.be/dQw4w9WgXcQ?list=PL123&t=42');
    await user.click(screen.getByRole('button', { name: 'Vorschau' }));

    expect(screen.getByTitle('YouTube-Vorschau: Video aus Link')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /✓ Herunterladen/ }));

    const [category, url, subfolder, onDone] = lastStart();
    expect([category, url, subfolder]).toEqual(['videos', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', undefined]);
    act(() => onDone('Clip.mp4'));
    expect(onSelect).toHaveBeenCalledWith('/videos/Clip.mp4');
  });

  it('rejects a link that is not a YouTube video', async () => {
    const { user } = await openYouTubeMode();
    await user.type(screen.getByLabelText(/URL einfügen:/i), 'https://example.com/watch?v=dQw4w9WgXcQ');
    await user.click(screen.getByRole('button', { name: 'Vorschau' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Keine gültige YouTube-URL');
    expect(screen.queryByRole('button', { name: /✓ Herunterladen/ })).not.toBeInTheDocument();
  });

  it('keeps the picker open with an error banner when the download fails', async () => {
    const { user, onSelect } = await openYouTubeMode();
    await searchAndPick(user);
    await user.click(screen.getByRole('button', { name: /✓ Herunterladen/ }));

    const onError = lastStart()[5];
    act(() => onError('Video nicht verfügbar'));
    expect(screen.getByText('Video nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /✓ Herunterladen/ })).toBeEnabled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('treats a download that ends without a file name as cancelled', async () => {
    const { user, onSelect } = await openYouTubeMode();
    await searchAndPick(user);
    await user.click(screen.getByRole('button', { name: /✓ Herunterladen/ }));

    act(() => lastStart()[3](''));
    expect(screen.getByText('Download abgebrochen')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves the question untouched when the picker was closed before the download finished', async () => {
    const { user, onSelect, unmount } = await openYouTubeMode();
    await searchAndPick(user);
    await user.click(screen.getByRole('button', { name: /✓ Herunterladen/ }));

    const onDone = lastStart()[3];
    unmount();
    onDone('Late.mp3');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
