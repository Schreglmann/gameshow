import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReplaceImageModal from '@/components/backend/ReplaceImageModal';

// AI-tab tests only — the existing replace flows are exercised in other suites
// + e2e. We mock the API surface to avoid a real server.

const mockFetchUpscalerInfo = vi.fn();
const mockUpscaleImageDryRun = vi.fn();
const mockUpscaleImageConfirm = vi.fn();

vi.mock('@/services/backendApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/backendApi')>('@/services/backendApi');
  return {
    ...actual,
    fetchUpscalerInfo: (...args: unknown[]) => mockFetchUpscalerInfo(...args),
    upscaleImageDryRun: (...args: unknown[]) => mockUpscaleImageDryRun(...args),
    upscaleImageConfirm: (...args: unknown[]) => mockUpscaleImageConfirm(...args),
    // Suppress search panel network call.
    searchImages: () => Promise.resolve({ results: [], partial: false, hasMore: false }),
  };
});

const baseProps = {
  target: 'Personen/Matthew Mercer.jpg',
  currentDims: { w: 480, h: 360 },
  currentSizeBytes: 42_000,
  renderBox: { w: 1920, h: 540 },
  onCancel: vi.fn(),
  onReplaced: vi.fn(),
};

beforeEach(() => {
  mockFetchUpscalerInfo.mockReset();
  mockUpscaleImageDryRun.mockReset();
  mockUpscaleImageConfirm.mockReset();
  baseProps.onCancel.mockReset();
  baseProps.onReplaced.mockReset();
});

describe('ReplaceImageModal — AI hochskalieren tab', () => {
  it('renders the AI tab button', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    render(<ReplaceImageModal {...baseProps} />);
    expect(await screen.findByRole('tab', { name: /AI hochskalieren/ })).toBeInTheDocument();
  });

  it('shows the predicted output dims for current source × scale', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal {...baseProps} />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    // 480×360, scale=4 (default since 480 < 960=halfW), clamped to renderBox 1920×540.
    expect(screen.getByText(/Aktuell: 480×360px → vorhergesagt:/)).toBeInTheDocument();
  });

  it('disables the run button when the binary is missing', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: false, models: [], scales: [], supportedExts: [],
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal {...baseProps} />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    await waitFor(() => {
      expect(screen.getByText(/AI-Upscaler nicht installiert/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Vorschau erstellen/ })).toBeDisabled();
  });

  it('blocks SVG sources with a German hint', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal {...baseProps} target="Logos/SVGs/foo.svg" />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    expect(screen.getByText(/Vektorgrafiken werden nicht hochskaliert/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vorschau erstellen/ })).toBeDisabled();
  });

  it('blocks GIF sources with a German hint', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal {...baseProps} target="Diverses/loop.gif" />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    expect(screen.getByText(/Animierte Bilder werden nicht unterstützt/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vorschau erstellen/ })).toBeDisabled();
  });

  it('warns about text-heavy categories without blocking', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal {...baseProps} target="Logos/foo.png" />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    expect(screen.getByText(/Text und Logos können durch AI-Upscaling verschlechtert werden/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vorschau erstellen/ })).toBeEnabled();
  });

  it('warns when the source is already at or above the render box', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal
      {...baseProps}
      target="Personen/already-big.jpg"
      currentDims={{ w: 2400, h: 1600 }}
    />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    expect(screen.getByText(/Das Bild ist bereits hoch genug aufgelöst/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vorschau erstellen/ })).toBeEnabled();
  });

  it('runs the dry-run and shows the preview pane on success', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    mockUpscaleImageDryRun.mockResolvedValue({
      success: true,
      target: baseProps.target,
      newDims: { w: 1920, h: 1440 },
      newSize: 360_000,
      previewUrl: '/api/backend/assets/images/upscale/preview/abc123',
      durationMs: 4200,
      cached: false,
      cacheKey: 'abc123',
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal {...baseProps} />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    await user.click(screen.getByRole('button', { name: /Vorschau erstellen/ }));

    await waitFor(() => {
      // The compare pane uses an <img> with the preview URL as src.
      const img = screen.getByAltText('neu') as HTMLImageElement;
      expect(img.src).toContain('/api/backend/assets/images/upscale/preview/abc123');
    });
    // Default scale is "Auto", which for a 480×360 source resolves to 2×
    // (480*2=960 < 1920 but 360*2=720 >= 648, so 2× already lifts the
    // image above the 1920×648 envelope). The 4th arg is a per-run
    // progressId (UUID) generated client-side.
    expect(mockUpscaleImageDryRun).toHaveBeenCalledWith(
      baseProps.target,
      'ultramix_balanced',
      2,
      expect.any(String),
    );
  });

  it('Auto resolves to 4× for very small sources', async () => {
    mockFetchUpscalerInfo.mockResolvedValue({
      available: true, models: ['ultramix_balanced', 'ultrasharp', 'digital_art'], scales: [2, 4],
      supportedExts: ['.jpg', '.jpeg', '.png', '.webp'],
    });
    mockUpscaleImageDryRun.mockResolvedValue({
      success: true, target: 'Personen/tiny.jpg',
      newDims: { w: 800, h: 600 }, newSize: 100_000,
      previewUrl: '/api/backend/assets/images/upscale/preview/xyz',
      durationMs: 4000, cached: false, cacheKey: 'xyz',
    });
    const user = userEvent.setup();
    render(<ReplaceImageModal
      {...baseProps}
      target="Personen/tiny.jpg"
      currentDims={{ w: 200, h: 150 }}
    />);
    await user.click(await screen.findByRole('tab', { name: /AI hochskalieren/ }));
    await user.click(screen.getByRole('button', { name: /Vorschau erstellen/ }));
    await waitFor(() => {
      expect(mockUpscaleImageDryRun).toHaveBeenCalledWith(
        'Personen/tiny.jpg',
        'ultramix_balanced',
        4,
        expect.any(String),
      );
    });
    // 200×150 → 2× would be 400×300 (still below 1920×648); 3× gives 600×450
    // (still below); so Auto picks 4× (output 800×600).
  });
});
