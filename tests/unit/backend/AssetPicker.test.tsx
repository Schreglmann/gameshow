import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetField, PickerModal } from '@/components/backend/AssetPicker';
import { resetReplacedImages } from '@/components/backend/replacedImages';

const mockFetchAssets = vi.fn();
const mockUploadAsset = vi.fn();
const mockDownloadImageFromUrl = vi.fn();
const mockSearchImages = vi.fn();
const mockSearchYouTube = vi.fn();
const mockUseUpload = vi.fn<() => unknown>(() => null);

vi.mock('@/services/backendApi', () => ({
  fetchAssets: (...args: unknown[]) => mockFetchAssets(...args),
  uploadAsset: (...args: unknown[]) => mockUploadAsset(...args),
  downloadImageFromUrl: (...args: unknown[]) => mockDownloadImageFromUrl(...args),
  searchImages: (...args: unknown[]) => mockSearchImages(...args),
  searchYouTube: (...args: unknown[]) => mockSearchYouTube(...args),
}));

// Stub of the replace modal: exposes its props and lets a test finish or cancel it.
type ReplaceProps = {
  target: string;
  currentDims?: { w: number; h: number } | null;
  renderBox?: { w: number; h: number };
  initialTab?: string;
  onCancel: () => void;
  onReplaced: (r: { target: string; newFilename: string; extensionChanged: boolean; version: number; newDims: { w: number; h: number } }) => void;
};
const replaceProps: { current: ReplaceProps | null } = { current: null };
vi.mock('@/components/backend/ReplaceImageModal', () => ({
  default: (props: ReplaceProps) => {
    replaceProps.current = props;
    return <div data-testid="replace-modal">{props.target}</div>;
  },
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

describe('AssetField image lightbox', () => {
  async function openLightbox(props: Partial<Parameters<typeof AssetField>[0]> = {}) {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<AssetField label="Bild" value="/images/Logos/foo.png" category="images" onChange={onChange} {...props} />);
    await user.click(screen.getByTitle('Vorschau'));
    return { user, onChange, ...view };
  }

  const lightboxImg = () => document.querySelector('.image-lightbox-body img') as HTMLImageElement;

  /** Simulates the lightbox image loading with the given natural size. */
  function measure(w: number, h: number) {
    const img = lightboxImg();
    Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
    act(() => { img.dispatchEvent(new Event('load')); });
  }

  beforeEach(() => {
    replaceProps.current = null;
    resetReplacedImages();
    mockFetchAssets.mockResolvedValue({ files: ['bar.jpg'], subfolders: [] });
  });

  it('Ersetzen opens the same picker as Ändern and sets the picked image on the question', async () => {
    const { user, onChange } = await openLightbox();
    await user.click(screen.getByRole('button', { name: 'Ersetzen' }));
    expect(screen.getByRole('button', { name: '🌐 Online' })).toBeInTheDocument();
    await user.click(await screen.findByTitle('bar.jpg'));
    expect(onChange).toHaveBeenCalledWith('/images/bar.jpg');
    // Picker closed, lightbox still open.
    expect(screen.queryByRole('button', { name: '🌐 Online' })).not.toBeInTheDocument();
    expect(lightboxImg()).not.toBeNull();
  });

  it('Hochskalieren opens the replace modal on the AI tab with the measured dims and render box', async () => {
    const { user } = await openLightbox({ renderBox: { w: 1920, h: 648 } });
    measure(350, 263);
    expect(screen.getByText('350 × 263px')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hochskalieren' }));
    expect(screen.getByTestId('replace-modal')).toHaveTextContent('Logos/foo.png');
    expect(replaceProps.current?.initialTab).toBe('ai');
    expect(replaceProps.current?.currentDims).toEqual({ w: 350, h: 263 });
    expect(replaceProps.current?.renderBox).toEqual({ w: 1920, h: 648 });
  });

  it('cache-busts the image after an upscale', async () => {
    const { user, onChange } = await openLightbox();
    measure(350, 263);
    await user.click(screen.getByRole('button', { name: 'Hochskalieren' }));
    act(() => replaceProps.current!.onReplaced({
      target: 'Logos/foo.png', newFilename: 'Logos/foo.png', extensionChanged: false, version: 42, newDims: { w: 1920, h: 1080 },
    }));
    expect(screen.queryByTestId('replace-modal')).not.toBeInTheDocument();
    expect(lightboxImg().getAttribute('src')).toBe('/images/Logos/foo.png?v=42');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the new file after a byte replace that changed the extension, without calling onChange', async () => {
    const { user, onChange } = await openLightbox();
    measure(350, 263);
    await user.click(screen.getByRole('button', { name: 'Hochskalieren' }));
    act(() => replaceProps.current!.onReplaced({
      target: 'Logos/foo.png', newFilename: 'Logos/foo.jpg', extensionChanged: true, version: 7, newDims: { w: 1920, h: 1080 },
    }));
    expect(lightboxImg().getAttribute('src')).toBe('/images/Logos/foo.jpg?v=7');
    expect(screen.getAllByText('foo.jpg').length).toBeGreaterThan(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Esc closes the picker or replace modal first, then the lightbox', async () => {
    const { user } = await openLightbox();
    await user.click(screen.getByRole('button', { name: 'Ersetzen' }));
    await screen.findByTitle('bar.jpg');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: '🌐 Online' })).not.toBeInTheDocument();
    expect(lightboxImg()).not.toBeNull();

    measure(350, 263);
    await user.click(screen.getByRole('button', { name: 'Hochskalieren' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('replace-modal')).not.toBeInTheDocument();
    expect(lightboxImg()).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(lightboxImg()).toBeNull();
  });

  it('offers Hochskalieren only for low-resolution images, like the DAM filter', async () => {
    await openLightbox();
    // Not measured yet → no button.
    expect(screen.queryByRole('button', { name: 'Hochskalieren' })).not.toBeInTheDocument();
    // Full width is enough (only one side must reach the box).
    measure(1920, 400);
    expect(screen.queryByRole('button', { name: 'Hochskalieren' })).not.toBeInTheDocument();
    // Both sides smaller than 1920 × 540 → low-res.
    measure(1800, 500);
    expect(screen.getByRole('button', { name: 'Hochskalieren' })).toBeInTheDocument();
  });

  it('uses the field render box: 1800 × 600 is low-res for image-guess but not for a quiz', async () => {
    const { unmount } = await openLightbox();
    measure(1800, 600);
    expect(screen.queryByRole('button', { name: 'Hochskalieren' })).not.toBeInTheDocument();
    unmount();

    await openLightbox({ renderBox: { w: 1920, h: 648 } });
    measure(1800, 600);
    expect(screen.getByRole('button', { name: 'Hochskalieren' })).toBeInTheDocument();
  });

  it('read-only fields get neither button', async () => {
    await openLightbox({ readOnly: true });
    measure(350, 263);
    expect(screen.queryByRole('button', { name: 'Ersetzen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hochskalieren' })).not.toBeInTheDocument();
  });

  it('offers Ersetzen but not Hochskalieren for SVGs and non-DAM paths', async () => {
    const { unmount } = await openLightbox({ value: '/images/Logos/Kim Possible.svg' });
    expect(screen.getByRole('button', { name: 'Ersetzen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hochskalieren' })).not.toBeInTheDocument();
    unmount();

    await openLightbox({ value: 'https://example.com/x.png' });
    expect(screen.getByRole('button', { name: 'Ersetzen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hochskalieren' })).not.toBeInTheDocument();
  });

  it('video fields keep the plain lightbox', async () => {
    const user = userEvent.setup();
    render(<AssetField label="Video" value="/videos/clip.mp4" category="videos" onChange={vi.fn()} />);
    await user.click(screen.getByTitle('Vorschau'));
    expect(screen.queryByRole('button', { name: 'Ersetzen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hochskalieren' })).not.toBeInTheDocument();
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

describe('PickerModal paste', () => {
  const PASTED_NAME = /^pasted-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/;
  const createObjectURL = vi.fn(() => 'blob:preview');
  const revokeObjectURL = vi.fn();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    mockUploadAsset.mockReset();
    mockDownloadImageFromUrl.mockReset();
    mockFetchAssets.mockResolvedValue({
      files: ['photo.jpg'],
      subfolders: [{ name: 'Logos', files: [], subfolders: [] }],
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  /** Dispatches a paste on the focused element; returns the event. */
  function paste(opts: { file?: File; text?: string }): Event {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: {
        items: opts.file ? [{ kind: 'file', type: opts.file.type, getAsFile: () => opts.file }] : [],
        getData: (type: string) => (type === 'text/plain' ? opts.text ?? '' : ''),
      },
    });
    act(() => { (document.activeElement ?? document.body).dispatchEvent(ev); });
    return ev;
  }

  const pngFile = () => new File(['png-bytes'], 'image.png', { type: 'image/png' });

  async function openPicker(props: Partial<Parameters<typeof PickerModal>[0]> = {}) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PickerModal category="images" onSelect={onSelect} onClose={onClose} {...props} />);
    await screen.findByText('photo.jpg');
    return { user, onSelect, onClose };
  }

  it('shows the paste hint for single image picks', async () => {
    await openPicker();
    expect(screen.getByText('Strg+V / ⌘V: Bild oder Bild-URL einfügen')).toBeInTheDocument();
  });

  it('previews a pasted image and uploads it into the chosen folder on confirm', async () => {
    mockUploadAsset.mockImplementation(async (_cat: string, file: File) => file.name);
    const { user, onSelect } = await openPicker();

    // The DAM tab's paste-to-upload listener must not also see the paste.
    const damListener = vi.fn();
    document.addEventListener('paste', damListener);
    const ev = paste({ file: pngFile() });
    document.removeEventListener('paste', damListener);
    expect(ev.defaultPrevented).toBe(true);
    expect(damListener).not.toHaveBeenCalled();

    expect(screen.getByText('Eingefügt')).toBeInTheDocument();
    expect(screen.getByAltText('Eingefügtes Bild')).toHaveAttribute('src', 'blob:preview');
    expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Speichern in:/i), 'Logos');
    await user.click(screen.getByRole('button', { name: '✓ Übernehmen' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const [category, file, subfolder] = mockUploadAsset.mock.calls[0] as [string, File, string];
    expect(category).toBe('images');
    expect(file.name).toMatch(PASTED_NAME);
    expect(file.type).toBe('image/png');
    expect(subfolder).toBe('Logos');
    expect(onSelect.mock.calls[0][0]).toMatch(/^\/images\/Logos\/pasted-.*\.png$/);
  });

  it('previews a pasted image URL and downloads it without a desired name', async () => {
    mockDownloadImageFromUrl.mockResolvedValue('Foo Bar.jpg');
    const { user, onSelect } = await openPicker();

    const ev = paste({ text: '  https://example.com/pics/Foo%20Bar.jpg?w=800 ' });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByAltText('Foo Bar.jpg')).toHaveAttribute('src', 'https://example.com/pics/Foo%20Bar.jpg?w=800');
    expect(screen.getByText(/Quelle: example\.com/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '✓ Übernehmen' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('/images/Foo Bar.jpg'));
    expect(mockDownloadImageFromUrl).toHaveBeenCalledWith('images', 'https://example.com/pics/Foo%20Bar.jpg?w=800', undefined);
    expect(mockUploadAsset).not.toHaveBeenCalled();
  });

  it('uploads a pasted data:image URL as a file', async () => {
    mockUploadAsset.mockImplementation(async (_cat: string, file: File) => file.name);
    const { user, onSelect } = await openPicker();

    paste({ text: 'data:image/png;base64,iVBORw0KGgo=' });
    await user.click(screen.getByRole('button', { name: '✓ Übernehmen' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect((mockUploadAsset.mock.calls[0][1] as File).name).toMatch(PASTED_NAME);
  });

  it('lets plain text through to the focused input', async () => {
    await openPicker();
    const ev = paste({ text: 'Matthew Mercer' });
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByText('Eingefügt')).not.toBeInTheDocument();
  });

  it('Esc discards the pasted image first, then closes the picker', async () => {
    const { user, onClose } = await openPicker();
    paste({ file: pngFile() });
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Eingefügt')).not.toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Verwerfen returns to the previous view', async () => {
    const { user } = await openPicker();
    paste({ text: 'https://example.com/x.png' });
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(screen.queryByText('Eingefügt')).not.toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('keeps the candidate and shows an error banner when saving fails', async () => {
    mockUploadAsset.mockRejectedValue(new Error('kaputt'));
    const { user, onSelect } = await openPicker();
    paste({ file: pngFile() });
    await user.click(screen.getByRole('button', { name: '✓ Übernehmen' }));

    expect(await screen.findByText('kaputt')).toBeInTheDocument();
    expect(screen.getByText('Eingefügt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '✓ Übernehmen' })).toBeEnabled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('also takes a paste in Online mode', async () => {
    const { user } = await openPicker();
    await user.click(screen.getByRole('button', { name: '🌐 Online' }));
    paste({ file: pngFile() });
    expect(screen.getByText('Eingefügt')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Suchbegriff')).not.toBeInTheDocument();
  });

  it('ignores pastes in multi-select mode and for other categories', async () => {
    const { unmount } = render(<PickerModal category="images" onSelect={vi.fn()} onClose={vi.fn()} multiSelect onMultiSelect={vi.fn()} />);
    await screen.findByText('photo.jpg');
    expect(paste({ file: pngFile() }).defaultPrevented).toBe(false);
    expect(screen.queryByText('Strg+V / ⌘V: Bild oder Bild-URL einfügen')).not.toBeInTheDocument();
    unmount();

    mockFetchAssets.mockResolvedValue({ files: ['song.mp3'], subfolders: [] });
    render(<PickerModal category="audio" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('song.mp3');
    expect(paste({ text: 'https://example.com/x.png' }).defaultPrevented).toBe(false);
    expect(screen.queryByText('Eingefügt')).not.toBeInTheDocument();
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
