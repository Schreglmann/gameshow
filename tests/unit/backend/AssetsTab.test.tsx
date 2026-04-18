import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, createEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssetsTab from '@/components/backend/AssetsTab';
import { UploadProvider } from '@/components/backend/UploadContext';

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
  probeVideo: () => Promise.resolve({ tracks: [], needsTranscode: false }),
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    expect(screen.getByRole('button', { name: 'Bilder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hintergrundmusik' })).toBeInTheDocument();
  });

  it('defaults to Bilder category', async () => {
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    const bilderBtn = screen.getByRole('button', { name: 'Bilder' });
    expect(bilderBtn).toHaveClass('active');
  });

  it('shows loading state initially', () => {
    mockFetchAssets.mockReturnValue(new Promise(() => {}));
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    expect(screen.getByText('Lade...')).toBeInTheDocument();
  });

  it('calls fetchAssets with "images" on mount', async () => {
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      expect(mockFetchAssets).toHaveBeenCalledWith('images');
    });
  });

  it('shows empty state when no images', async () => {
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('Keine Bilder vorhanden')).toBeInTheDocument();
    });
  });

  it('renders image grid when images are available', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg', 'logo.png'], subfolders: [] });
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('logo.png')).toBeInTheDocument();
    });
  });

  it('renders delete buttons for each image', async () => {
    mockFetchAssets.mockResolvedValue({ files: ['photo.jpg', 'logo.png'], subfolders: [] });
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      const deleteButtons = screen.getAllByTitle('Löschen');
      expect(deleteButtons).toHaveLength(2);
    });
  });

  it('switches to Audio category on tab click', async () => {
    const user = userEvent.setup();
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Audio' }));
    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });
  });

  it('renders upload zone for all categories', async () => {
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText(/Dateien hier ablegen oder klicken zum Auswählen/)).toBeInTheDocument();
    });
  });

  it('shows folder create button in search row', async () => {
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByTitle('Ordner erstellen')).toBeInTheDocument();
    });
  });

  it('creates a new folder via prompt modal', async () => {
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
    const user = userEvent.setup();
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
    render(<UploadProvider><AssetsTab /></UploadProvider>);
    await waitFor(() => {
      expect(screen.getByText(/Fehler beim Laden: Fetch error/)).toBeInTheDocument();
    });
  });

  it('loads assets for new category when tab is switched', async () => {
    const user = userEvent.setup();
    render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const zone = document.querySelector('.upload-zone')!;
      fireEvent.dragEnter(zone);
      expect(zone).toHaveClass('dragover');
    });

    it('removes dragover class from root upload zone on dragleave', async () => {
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const zone = document.querySelector('.upload-zone')!;
      fireEvent.dragEnter(zone);
      fireEvent.dragLeave(zone);
      expect(zone).not.toHaveClass('dragover');
    });

    it('uploads dropped file to root (no subfolder)', async () => {
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
      await dropFiles(document.querySelector('.upload-zone')!, [file]);

      await waitFor(() => {
        expect(mockUploadAsset).toHaveBeenCalledWith('images', file, undefined, expect.any(Function), expect.any(Function), expect.any(AbortSignal));
      });
    });

    it('shows success message after dropping file on root zone', async () => {
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      await dropFiles(document.querySelector('.upload-zone')!, [
        new File(['img'], 'photo.jpg', { type: 'image/jpeg' }),
      ]);

      await waitFor(() => {
        expect(screen.getByText(/hochgeladen/)).toBeInTheDocument();
      });
    });

    it('uploads all files when multiple are dropped at once', async () => {
      render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      await dropFiles(document.querySelector('.asset-folder')!, [
        new File(['img'], 'tree.jpg', { type: 'image/jpeg' }),
      ]);

      await waitFor(() => {
        expect(screen.getByText(/hochgeladen/)).toBeInTheDocument();
      });
    });

    it('dragover class on root zone is cleared after drop', async () => {
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      const zone = document.querySelector('.upload-zone')!;
      fireEvent.dragEnter(zone);
      expect(zone).toHaveClass('dragover');

      await dropFiles(zone, [new File(['img'], 'photo.jpg', { type: 'image/jpeg' })]);
      expect(zone).not.toHaveClass('dragover');
    });

    it('does nothing when empty drop (no files) on upload zone', async () => {
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText(/Dateien hier ablegen/)).toBeInTheDocument());

      await dropFiles(document.querySelector('.upload-zone')!, []);
      expect(mockUploadAsset).not.toHaveBeenCalled();
    });

    // ── Drag to move existing assets ─────────────────────────────────────────

    it('image cards have draggable attribute', async () => {
      mockFetchAssets.mockResolvedValue({ files: ['photo.jpg'], subfolders: [] });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('photo.jpg')).toBeInTheDocument());

      const card = document.querySelector('.asset-image-card')!;
      expect(card.getAttribute('draggable')).toBe('true');
    });

    it('dropping asset card on folder calls moveAsset with folder path', async () => {
      mockFetchAssets.mockResolvedValue({
        files: ['photo.jpg'],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
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
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      // Dropping 'Natur/tree.jpg' back onto 'Natur' folder → same location
      dropAsset(document.querySelector('.asset-folder')!, 'Natur/tree.jpg');

      await new Promise(r => setTimeout(r, 50));
      expect(mockMoveAsset).not.toHaveBeenCalled();
    });
  });

  // ── Folder drag & select ────────────────────────────────────────────────────

  describe('Folder drag & drop and selection', () => {
    // Helper: simulate dropping a dragged folder onto an element
    const dropFolder = (element: Element, folderPath: string) => {
      const event = createEvent.drop(element);
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [], getData: (key: string) => key === 'text/asset-folder-path' ? folderPath : '' },
      });
      fireEvent(element, event);
    };

    it('folder header is draggable', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());
      const header = screen.getByText('Natur').closest('.asset-folder-header')!;
      expect(header.getAttribute('draggable')).toBe('true');
    });

    it('dropping a folder onto another folder calls moveAsset with the new parent path', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [
          { name: 'Themes', files: [], subfolders: [] },
          { name: 'Retro', files: [], subfolders: [] },
        ],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Themes')).toBeInTheDocument());

      const themesZone = screen.getByText('Themes').closest('.asset-folder')!;
      await act(async () => {});
      dropFolder(themesZone, 'Retro');

      await waitFor(() => {
        expect(mockMoveAsset).toHaveBeenCalledWith('images', 'Retro', 'Themes/Retro');
      });
    });

    it('dropping a nested folder anywhere in the DAM panel (not on a folder row) moves it to root', async () => {
      // The user should be able to drag a nested folder and drop it to the left of
      // the folder rows — or anywhere in the DAM panel that isn't a specific drop
      // target — and have it land at the category root. The outer container has a
      // synthetic onDrop that catches folder drags that bubble past every inner DropZone.
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [
          { name: 'Themes', files: [], subfolders: [{ name: 'Retro', files: [], subfolders: [] }] },
        ],
      });
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Themes')).toBeInTheDocument());
      // Expand "Themes" so "Retro" is in the DOM.
      await user.click(screen.getByText('Themes').closest('.asset-folder-header')!);

      // Put the component into the "currently dragging Themes/Retro" state by
      // firing a dragStart on the inner folder header (populates currentFolderDrag),
      // then fire a React synthetic drop on the outer category-tabs area which
      // isn't inside any inner DropZone.
      const retroHeader = screen.getByText('Retro').closest('.asset-folder-header')!;
      fireEvent.dragStart(retroHeader, {
        dataTransfer: { setData: () => {}, effectAllowed: '', types: [] },
      });

      const categoryTabs = document.querySelector('.asset-category-tabs')!;
      fireEvent.drop(categoryTabs);

      await waitFor(() => {
        expect(mockMoveAsset).toHaveBeenCalledWith('images', 'Themes/Retro', 'Retro');
      });
    });

    it('moving a root folder into another root folder is not blocked by the root-drop gutter wrapper', async () => {
      // Regression: the `.asset-folders-root-zone` wrapper considers dragging any
      // root folder to be a same-parent no-op. Its dragover handler must not bubble
      // up from the inner folder row and stamp dropEffect=none onto a valid drop.
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [
          { name: 'Computerspiele', files: [], subfolders: [] },
          { name: 'Diverses', files: [], subfolders: [] },
        ],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Diverses')).toBeInTheDocument());

      const diversesZone = screen.getByText('Diverses').closest('.asset-folder')!;
      await act(async () => {});
      dropFolder(diversesZone, 'Computerspiele');

      await waitFor(() => {
        expect(mockMoveAsset).toHaveBeenCalledWith('images', 'Computerspiele', 'Diverses/Computerspiele');
      });
    });

    it('dropping a folder on its current parent (root) is a no-op', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Retro', files: [], subfolders: [] }],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Retro')).toBeInTheDocument());

      // Drop 'Retro' (whose parent is root) onto the root upload zone
      const rootZone = document.querySelector('.upload-zone')!;
      await act(async () => {});
      dropFolder(rootZone, 'Retro');

      // The DropZone rejects invalid drags before they hit the handler; no moveAsset call
      await new Promise(r => setTimeout(r, 50));
      // Note: the folderDrop handler still fires because in tests we don't populate
      // currentFolderDrag via a real dragstart event. We rely on client validation
      // in handleMoveFolder to short-circuit via fromPath === targetPath.
      const call = mockMoveAsset.mock.calls.find(c => c[1] === 'Retro' && c[2] === 'Retro');
      expect(call).toBeUndefined();
    });

    it('clicking a folder name in select mode toggles folder selection (not rename)', async () => {
      mockFetchAssets.mockResolvedValue({
        files: ['a.jpg'],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      // Enter select mode via the "Auswählen" button
      fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }));

      // Click the folder name
      fireEvent.click(screen.getByText('Natur'));

      // Folder header should have the --selected class; no rename input should appear
      expect(document.querySelector('.asset-folder-header--selected')).not.toBeNull();
      expect(document.querySelector('.asset-folder-rename-input')).toBeNull();
    });

    it('combined count in toolbar includes folders', async () => {
      mockFetchAssets.mockResolvedValue({
        files: ['a.jpg'],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }));
      // Select the folder
      fireEvent.click(screen.getByText('Natur'));
      // Select the image (cmd+click)
      const card = document.querySelector('.asset-image-card')!;
      fireEvent.click(card, { metaKey: true });

      expect(screen.getByText(/1 Datei\s*\+\s*1 Ordner ausgewählt/)).toBeInTheDocument();
    });

    it('Escape clears both selectedFiles and selectedFolders', async () => {
      mockFetchAssets.mockResolvedValue({
        files: [],
        subfolders: [{ name: 'Natur', files: [], subfolders: [] }],
      });
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('Natur')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }));
      fireEvent.click(screen.getByText('Natur'));
      expect(document.querySelector('.asset-folder-header--selected')).not.toBeNull();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.querySelector('.asset-folder-header--selected')).toBeNull();
    });
  });

  // ── Multi-select / Shift-selection ──────────────────────────────────────────

  describe('Multi-select shift-selection', () => {
    const fiveFiles = { files: ['b.jpg', 'e.jpg', 'a.jpg', 'd.jpg', 'c.jpg'], subfolders: [] };
    // After name-sort: a.jpg, b.jpg, c.jpg, d.jpg, e.jpg

    const getSelectedNames = () =>
      Array.from(document.querySelectorAll('.asset-image-card--selected .asset-image-card-name'))
        .map(el => el.textContent);

    const getCardByName = (name: string) => {
      const cards = document.querySelectorAll('.asset-image-card');
      for (const card of cards) {
        if (card.querySelector('.asset-image-card-name')?.textContent === name) return card as HTMLElement;
      }
      return null;
    };

    it('enters selection mode on Cmd+click and selects that item', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      fireEvent.click(getCardByName('b.jpg')!, { metaKey: true });
      expect(getSelectedNames()).toEqual(['b.jpg']);
      expect(screen.getByText('1 Datei ausgewählt')).toBeInTheDocument();
    });

    it('shift+click selects full range from anchor to target', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      // Enter selection mode
      await user.click(screen.getByText('Auswählen'));
      // Click a.jpg as anchor
      fireEvent.click(getCardByName('a.jpg')!);
      // Shift+click d.jpg → should select a, b, c, d
      fireEvent.click(getCardByName('d.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    });

    it('shift+click to closer item shrinks the range', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      fireEvent.click(getCardByName('a.jpg')!);
      // First extend to d.jpg
      fireEvent.click(getCardByName('d.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
      // Shrink to b.jpg — should deselect c and d
      fireEvent.click(getCardByName('b.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg']);
    });

    it('shift+click to farther item expands the range', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      fireEvent.click(getCardByName('a.jpg')!);
      fireEvent.click(getCardByName('b.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg']);
      // Expand to e.jpg
      fireEvent.click(getCardByName('e.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
    });

    it('plain click sets new anchor; subsequent shift+click uses it', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      // Click a.jpg, shift to c.jpg → a,b,c
      fireEvent.click(getCardByName('a.jpg')!);
      fireEvent.click(getCardByName('c.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
      // Plain click e.jpg → new anchor, toggle on e.jpg (base = {a,b,c,e})
      fireEvent.click(getCardByName('e.jpg')!);
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'e.jpg']);
      // Shift+click d.jpg from anchor e → base ∪ range(e,d) = {a,b,c,e} ∪ {d,e} = {a,b,c,d,e}
      fireEvent.click(getCardByName('d.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
    });

    it('plain click toggles off a selected item', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      fireEvent.click(getCardByName('a.jpg')!);
      fireEvent.click(getCardByName('c.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
      // Toggle off b.jpg
      fireEvent.click(getCardByName('b.jpg')!);
      expect(getSelectedNames()).toEqual(['a.jpg', 'c.jpg']);
    });

    it('Escape exits selection mode and clears selection', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      fireEvent.click(getCardByName('a.jpg')!);
      expect(getSelectedNames()).toEqual(['a.jpg']);
      await user.keyboard('{Escape}');
      expect(getSelectedNames()).toEqual([]);
      expect(screen.queryByText(/ausgewählt/)).not.toBeInTheDocument();
    });

    it('"Keine" button clears all selections', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      fireEvent.click(getCardByName('a.jpg')!);
      fireEvent.click(getCardByName('e.jpg')!, { shiftKey: true });
      expect(getSelectedNames().length).toBe(5);
      await user.click(screen.getByText('Keine'));
      expect(getSelectedNames()).toEqual([]);
    });

    it('shift+click works with sorted file order', async () => {
      // Files arrive unsorted but should be displayed sorted by name
      mockFetchAssets.mockResolvedValue({ files: ['z.jpg', 'm.jpg', 'a.jpg'], subfolders: [] });
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      fireEvent.click(getCardByName('a.jpg')!);
      fireEvent.click(getCardByName('z.jpg')!, { shiftKey: true });
      // Sorted order: a, m, z → all three selected
      expect(getSelectedNames()).toEqual(['a.jpg', 'm.jpg', 'z.jpg']);
    });

    it('shift+click across folder and root files selects the range', async () => {
      mockFetchAssets.mockResolvedValue({
        files: ['root.jpg'],
        subfolders: [{ name: 'folder', files: ['f1.jpg', 'f2.jpg'], subfolders: [] }],
      });
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('folder')).toBeInTheDocument());

      // Expand folder
      await user.click(screen.getByText('folder').closest('.asset-folder-header')!);
      await waitFor(() => expect(screen.getByText('f1.jpg')).toBeInTheDocument());

      // Enter selection mode
      await user.click(screen.getByText('Auswählen'));
      // Click f1.jpg (in folder), shift+click root.jpg
      fireEvent.click(getCardByName('f1.jpg')!);
      fireEvent.click(getCardByName('root.jpg')!, { shiftKey: true });
      // Display order: folder files (f1, f2) then root (root) → all 3
      expect(getSelectedNames()).toEqual(['f1.jpg', 'f2.jpg', 'root.jpg']);
    });

    it('shift+click preserves base selection from individual toggles', async () => {
      mockFetchAssets.mockResolvedValue(fiveFiles);
      const user = userEvent.setup();
      render(<UploadProvider><AssetsTab /></UploadProvider>);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      await user.click(screen.getByText('Auswählen'));
      // Individually toggle on a.jpg and e.jpg
      fireEvent.click(getCardByName('a.jpg')!);
      fireEvent.click(getCardByName('e.jpg')!);
      expect(getSelectedNames()).toEqual(['a.jpg', 'e.jpg']);
      // Shift+click c.jpg from anchor e → base {a,e} ∪ range(e,c) = {a,c,d,e}
      fireEvent.click(getCardByName('c.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
      // Shift+click d.jpg → shrink range to {d,e}, base stays {a,e} → {a,d,e}
      fireEvent.click(getCardByName('d.jpg')!, { shiftKey: true });
      expect(getSelectedNames()).toEqual(['a.jpg', 'd.jpg', 'e.jpg']);
    });
  });
});
