import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, createEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssetsTab from '@/components/backend/AssetsTab';
import { UploadProvider } from '@/components/backend/UploadContext';
import { TranscodeProvider } from '@/components/backend/TranscodeContext';

const mockFetchAssets = vi.fn();
const mockUploadAsset = vi.fn();
const mockDeleteAsset = vi.fn();
const mockFetchAssetUsages = vi.fn();
const mockMoveAsset = vi.fn();
const mockCreateAssetFolder = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchAssets: (...args: unknown[]) => mockFetchAssets(...args),
  uploadAsset: (...args: unknown[]) => mockUploadAsset(...args),
  deleteAsset: (...args: unknown[]) => mockDeleteAsset(...args),
  fetchAssetUsages: (...args: unknown[]) => mockFetchAssetUsages(...args),
  moveAsset: (...args: unknown[]) => mockMoveAsset(...args),
  createAssetFolder: (...args: unknown[]) => mockCreateAssetFolder(...args),
  fetchAssetStorage: () => Promise.resolve({ mode: 'local', path: '/local' }),
  probeVideo: () => Promise.resolve({ tracks: [], needsTranscode: false }),
  startTranscode: () => Promise.resolve({ status: 'running', percent: 0 }),
  fetchTranscodeStatus: () => Promise.resolve([]),
  youtubeDownload: vi.fn(),
  fetchVideoCover: () => Promise.resolve({ posterPath: null, logs: [] }),
}));

// Helper: simulate dropping OS files onto an element.
// Flushes pending effects first so DropZone's native addEventListener is registered.
async function dropFiles(element: Element, files: File[]) {
  await act(async () => {});
  const event = createEvent.drop(element);
  Object.defineProperty(event, 'dataTransfer', { value: { files, getData: () => '' } });
  fireEvent(element, event);
}

// Helper: simulate dropping a dragged asset card onto an element
function dropAsset(element: Element, assetPath: string) {
  const event = createEvent.drop(element);
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: [], getData: (key: string) => key === 'text/asset-path' ? assetPath : '' },
  });
  fireEvent(element, event);
}

describe('AssetsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
    mockUploadAsset.mockResolvedValue('uploaded.jpg');
    mockDeleteAsset.mockResolvedValue(undefined);
    mockFetchAssetUsages.mockResolvedValue([]);
    mockMoveAsset.mockResolvedValue(undefined);
    mockCreateAssetFolder.mockResolvedValue(undefined);
  });

  it('renders category tabs', async () => {
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    expect(screen.getByRole('button', { name: 'Bilder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hintergrundmusik' })).toBeInTheDocument();
  });

  it('defaults to Bilder category', async () => {
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    const bilderBtn = screen.getByRole('button', { name: 'Bilder' });
    expect(bilderBtn).toHaveClass('active');
  });

  it('shows loading state initially', () => {
    mockFetchAssets.mockReturnValue(new Promise(() => {}));
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    expect(screen.getByText('Lade...')).toBeInTheDocument();
  });

  it('calls fetchAssets with "images" on mount', async () => {
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(mockFetchAssets).toHaveBeenCalledWith('images');
    });
  });

  it('shows empty state when no images', async () => {
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('Keine Bilder vorhanden')).toBeInTheDocument();
    });
  });

  it('renders image grid when images are available', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg', 'logo.png'], subfolders: [] });
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('logo.png')).toBeInTheDocument();
    });
  });

  it('renders delete buttons for each image', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg', 'logo.png'], subfolders: [] });
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      const deleteButtons = screen.getAllByTitle('Löschen');
      expect(deleteButtons).toHaveLength(2);
    });
  });

  it('switches to Audio category on tab click', async () => {
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Audio' }));
    await waitFor(() => {
      expect(mockFetchAssets).toHaveBeenCalledWith('audio');
    });
  });

  it('shows empty state for audio when no files', async () => {
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Audio' }));
    await waitFor(() => {
      expect(screen.getByText('Keine Audiodateien vorhanden')).toBeInTheDocument();
    });
  });

  it('renders audio list when audio files are available', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['song.mp3'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Audio' }));
    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });
  });

  it('renders upload zone for all categories', async () => {
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText(/Dateien hier ablegen oder klicken zum Auswählen/)).toBeInTheDocument();
    });
  });

  it('shows folder create button in search row', async () => {
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Ordner erstellen')).toBeInTheDocument();
    });
  });

  it('creates a new folder via prompt modal', async () => {
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Ordner erstellen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Ordner erstellen'));
    const input = screen.getByPlaceholderText('Name…');
    expect(input).toBeInTheDocument();
    await user.type(input, 'Beatles');
    await user.click(screen.getByRole('button', { name: 'Erstellen' }));
    expect(screen.getByText('Beatles')).toBeInTheDocument();
  });

  it('shows success message after creating folder', async () => {
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Ordner erstellen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Ordner erstellen'));
    await user.type(screen.getByPlaceholderText('Name…'), 'Beatles');
    await user.click(screen.getByRole('button', { name: 'Erstellen' }));
    await waitFor(() => {
      expect(screen.getByText(/Ordner.*erstellt/)).toBeInTheDocument();
    });
  });

  it('does not create folder when prompt is cancelled', async () => {
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Ordner erstellen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Ordner erstellen'));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(mockCreateAssetFolder).not.toHaveBeenCalled();
  });

  it('renders existing subfolders', async () => {
    mockFetchAssets.mockResolvedValue({
      files: [],
      subfolders: [
        { name: 'Beatles', files: ['hey-jude.mp3'], subfolders: [] },
      ],
    });
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('Beatles')).toBeInTheDocument();
    });
  });

  it('shows folder file count', async () => {
    mockFetchAssets.mockResolvedValue({
      files: [],
      subfolders: [
        { name: 'Beatles', files: ['song1.mp3', 'song2.mp3'], subfolders: [] },
      ],
    });
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('2 Dateien')).toBeInTheDocument();
    });
  });

  it('expands folder when header is clicked', async () => {
    mockFetchAssets.mockResolvedValue({
      files: [],
      subfolders: [{ name: 'Beatles', files: ['hey-jude.mp3'], subfolders: [] }],
    });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('Beatles')).toBeInTheDocument();
    });
    // Click the folder header (chevron area), not the name (which triggers rename)
    await user.click(screen.getByText('Beatles').closest('.asset-folder-header')!);
    expect(screen.getByText('hey-jude.mp3')).toBeInTheDocument();
  });

  it('collapses folder when header is clicked again', async () => {
    mockFetchAssets.mockResolvedValue({
      files: [],
      subfolders: [{ name: 'Beatles', files: ['hey-jude.mp3'], subfolders: [] }],
    });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('Beatles')).toBeInTheDocument();
    });
    const header = screen.getByText('Beatles').closest('.asset-folder-header')!;
    await user.click(header);
    expect(screen.getByText('hey-jude.mp3')).toBeInTheDocument();
    await user.click(header);
    expect(screen.queryByText('hey-jude.mp3')).not.toBeInTheDocument();
  });

  it('calls deleteAsset when delete button is clicked for an image', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Löschen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Löschen'));
    await waitFor(() => {
      expect(mockDeleteAsset).toHaveBeenCalledWith('images', 'photo.jpg');
    });
  });

  it('shows success message after deleting asset', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Löschen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Löschen'));
    await waitFor(() => {
      expect(screen.getByText(/gelöscht/)).toBeInTheDocument();
    });
  });

  it('requires confirm before deleting', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Löschen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Löschen'));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('wirklich löschen'));
    confirmSpy.mockRestore();
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Löschen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Löschen'));
    expect(mockDeleteAsset).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('shows error when delete fails', async () => {
    mockDeleteAsset.mockRejectedValueOnce(new Error('Delete failed'));
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Löschen')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('Löschen'));
    await waitFor(() => {
      expect(screen.getByText(/Fehler.*Delete failed/)).toBeInTheDocument();
    });
  });

  it('opens image lightbox when image card is clicked', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    const imgCard = document.querySelector('.asset-image-card');
    if (imgCard) await user.click(imgCard);
    expect(screen.getByText('photo.jpg', { selector: '.image-lightbox-name' })).toBeInTheDocument();
  });

  it('closes lightbox when close button is clicked', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    const imgCard = document.querySelector('.asset-image-card');
    if (imgCard) await user.click(imgCard);
    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByText('photo.jpg', { selector: '.image-lightbox-name' })).not.toBeInTheDocument();
  });

  it('closes lightbox when overlay is clicked', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    const imgCard = document.querySelector('.asset-image-card');
    if (imgCard) await user.click(imgCard);
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) await user.click(overlay);
    expect(screen.queryByText('photo.jpg', { selector: '.image-lightbox-name' })).not.toBeInTheDocument();
  });

  it('shows error when fetchAssets fails', async () => {
    mockFetchAssets.mockRejectedValueOnce(new Error('Fetch error'));
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText(/Fehler beim Laden: Fetch error/)).toBeInTheDocument();
    });
  });

  it('loads assets for new category when tab is switched', async () => {
    const user = userEvent.setup();
    render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
    await waitFor(() => {
      expect(mockFetchAssets).toHaveBeenCalledWith('images');
    });
    await user.click(screen.getByRole('button', { name: 'Hintergrundmusik' }));
    await waitFor(() => {
      expect(mockFetchAssets).toHaveBeenCalledWith('background-music');
    });
  });

  // ── Drag & Drop ──────────────────────────────────────────────────────────────

  describe('Drag & Drop file upload', () => {
    it('adds dragover class to root upload zone on dragenter', async () => {
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const zone = document.querySelector('.upload-zone')!;
      fireEvent.dragEnter(zone);
      expect(zone).toHaveClass('dragover');
    });

    it('removes dragover class from root upload zone on dragleave', async () => {
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const zone = document.querySelector('.upload-zone')!;
      fireEvent.dragEnter(zone);
      fireEvent.dragLeave(zone);
      expect(zone).not.toHaveClass('dragover');
    });

    it('uploads dropped file to root (no subfolder)', async () => {
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
      await dropFiles(document.querySelector('.upload-zone')!, [file]);

      await waitFor(() => {
        expect(mockUploadAsset).toHaveBeenCalledWith('images', file, undefined, expect.any(Function), expect.any(Function), expect.any(AbortSignal));
      });
    });

    it('shows success message after dropping file on root zone', async () => {
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      await dropFiles(document.querySelector('.upload-zone')!, [
        new File(['img'], 'photo.jpg', { type: 'image/jpeg' }),
      ]);

      await waitFor(() => {
        expect(screen.getByText(/hochgeladen/)).toBeInTheDocument();
      });
    });

    it('uploads all files when multiple are dropped at once', async () => {
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      await dropFiles(document.querySelector('.upload-zone')!, [
        new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
        new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
      ]);

      await waitFor(() => {
        expect(mockUploadAsset).toHaveBeenCalledTimes(3);
      });
    });

    it('adds dragover class to folder zone on dragenter', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      const folder = document.querySelector('.asset-folder')!;
      fireEvent.dragEnter(folder);
      expect(folder).toHaveClass('dragover');
    });

    it('removes dragover class from folder zone on dragleave', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      const folder = document.querySelector('.asset-folder')!;
      fireEvent.dragEnter(folder);
      fireEvent.dragLeave(folder);
      expect(folder).not.toHaveClass('dragover');
    });

    it('uploads dropped file into folder with folder path as subfolder', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      const file = new File(['img'], 'tree.jpg', { type: 'image/jpeg' });
      await dropFiles(document.querySelector('.asset-folder')!, [file]);

      await waitFor(() => {
        expect(mockUploadAsset).toHaveBeenCalledWith('images', file, 'Natur', expect.any(Function), expect.any(Function), expect.any(AbortSignal));
      });
    });

    it('shows success message after dropping file on folder zone', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      await dropFiles(document.querySelector('.asset-folder')!, [
        new File(['img'], 'tree.jpg', { type: 'image/jpeg' }),
      ]);

      await waitFor(() => {
        expect(screen.getByText(/hochgeladen/)).toBeInTheDocument();
      });
    });

    it('dragover class on root zone is cleared after drop', async () => {
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const zone = document.querySelector('.upload-zone')!;
      fireEvent.dragEnter(zone);
      expect(zone).toHaveClass('dragover');

      await dropFiles(zone, [new File(['img'], 'photo.jpg', { type: 'image/jpeg' })]);
      expect(zone).not.toHaveClass('dragover');
    });

    it('does nothing when empty drop (no files) on upload zone', async () => {
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      await dropFiles(document.querySelector('.upload-zone')!, []);
      expect(mockUploadAsset).not.toHaveBeenCalled();
    });

    // ── Drag to move existing assets ─────────────────────────────────────────

    it('image cards have draggable attribute', async () => {
      mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('photo.jpg')).toBeInTheDocument());

      const card = document.querySelector('.asset-image-card')!;
      expect(card.getAttribute('draggable')).toBe('true');
    });

    it('dropping asset card on folder calls moveAsset with folder path', async () => {
      mockFetchAssets.mockResolvedValue({
        files: ['photo.jpg'],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      dropAsset(document.querySelector('.asset-folder')!, 'photo.jpg');

      await waitFor(() => {
        expect(mockMoveAsset).toHaveBeenCalledWith('images', 'photo.jpg', 'Natur/photo.jpg');
      });
    });

    it('dropping folder image on root upload zone moves to root', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: ['tree.jpg'], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      dropAsset(document.querySelector('.upload-zone')!, 'Natur/tree.jpg');

      await waitFor(() => {
        expect(mockMoveAsset).toHaveBeenCalledWith('images', 'Natur/tree.jpg', 'tree.jpg');
      });
    });

    it('shows success message after drag-to-move', async () => {
      mockFetchAssets.mockResolvedValue({
        files: ['photo.jpg'],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      dropAsset(document.querySelector('.asset-folder')!, 'photo.jpg');

      await waitFor(() => {
        expect(screen.getByText(/verschoben/)).toBeInTheDocument();
      });
    });

    it('does not call moveAsset when dropping asset on its current location', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: ['tree.jpg'], subfolders: [] }],
      });
      render(<UploadProvider><TranscodeProvider><AssetsTab /></TranscodeProvider></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      // Dropping 'Natur/tree.jpg' back onto 'Natur' folder → same location
      dropAsset(document.querySelector('.asset-folder')!, 'Natur/tree.jpg');

      await new Promise(r => setTimeout(r, 50));
      expect(mockMoveAsset).not.toHaveBeenCalled();
    });
  });
});
