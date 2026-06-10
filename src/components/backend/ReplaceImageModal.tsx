import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl } from '@/utils/assetUrl';
import {
  replaceImageFromUrl,
  replaceImageFromFile,
  fetchUpscalerInfo,
  upscaleImageDryRun,
  upscaleImageConfirm,
  upscaleProgressUrl,
  ApiError,
  type ImageSearchResult,
  type ImageReplaceResponse,
  type ImageReplaceResult,
  UPSCALE_SCALES,
  type UpscaleModel,
  type UpscaleScale,
  type UpscalerInfo,
} from '../../services/backendApi';
import ImageSearchPanel from './ImageSearchPanel';

// Modal for replacing an image's bytes in the DAM with a higher-res or
// better-fitting one. Four tabs:
//   - "Suchen"             — server-side search via DuckDuckGo / Wikimedia / OpenVerse
//   - "URL einfügen"       — paste any image URL (Google/Bing redirect-unwrapped server-side)
//   - "Datei / Einfügen"   — drag-and-drop, file picker, or Strg+V from clipboard
//   - "AI hochskalieren" — local-AI upscale via upscayl-ncnn (see specs/dam-image-upscale.md)
//
// Strg+V works on every tab — a document-level paste listener is mounted on
// open and removed on close so it doesn't collide with the global DAM
// paste-to-upload handler.

type Tab = 'search' | 'url' | 'file' | 'ai';

const AI_MODEL_LABELS: Record<UpscaleModel, string> = {
  ultramix_balanced: 'Ultramix Balanced — Fotos, Personen, gemischt (empfohlen)',
  ultrasharp: 'Ultrasharp — sehr scharf, schlecht bei Text & Logos',
  digital_art: 'Digital Art — Illustrationen, Cover, Comics',
};

const UPSCALE_SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// German-locale number with a comma decimal: 1.5 → "1,5", 2 → "2".
const formatScaleNumber = (s: number): string =>
  Number.isInteger(s) ? String(s) : String(s).replace('.', ',');

// Dropdown labels: just the number for most scales; 4× gets a hint because
// it's the AI model's native output (no Sharp downscale).
const SCALE_HINTS: Record<number, string> = {
  4: 'volle AI-Auflösung',
};
const formatScaleLabel = (s: number): string => {
  const hint = SCALE_HINTS[s];
  return hint ? `${formatScaleNumber(s)}× — ${hint}` : `${formatScaleNumber(s)}×`;
};

interface Props {
  target: string;                // relative path of the image being replaced, e.g. "Logos/foo.png"
  currentDims?: { w: number; h: number } | null;
  currentSizeBytes?: number;
  // Frontend render box for this image (1920×540 for quiz games, 1920×648 for
  // image-guess). Used by the resolution filter so it shares the predicate
  // with the DAM's "Niedrige Auflösung" filter — see specs/admin-backend.md.
  renderBox?: { w: number; h: number };
  onCancel: () => void;
  onReplaced: (result: ImageReplaceResult) => void;
}

interface AiCandidate {
  model: UpscaleModel;
  scale: UpscaleScale;
  newDims: { w: number; h: number };
  newSize: number;
  durationMs: number;
  cacheKey: string;
  // Preview URL stored on the cached entry so it can be restored verbatim
  // when the dropdown selection returns to this (model, scale) combo.
  previewUrl?: string;
}

interface Candidate {
  type: 'search' | 'url' | 'file' | 'ai';
  search?: ImageSearchResult;
  url?: string;
  file?: File;
  ai?: AiCandidate;
  // local preview URL (object URL for file, candidate URL otherwise)
  previewUrl: string;
}

function deriveDefaultQuery(target: string): string {
  const base = target.split('/').pop() || target;
  return base
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function fmtBytes(n: number | undefined): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDims(d: { w: number; h: number } | null | undefined): string {
  if (!d || (d.w === 0 && d.h === 0)) return '—';
  return `${d.w} × ${d.h}px`;
}

export default function ReplaceImageModal({
  target,
  currentDims,
  currentSizeBytes,
  renderBox,
  onCancel,
  onReplaced,
}: Props) {
  const [tab, setTab] = useState<Tab>('search');
  // Search panel state is now owned by <ImageSearchPanel>; only the picked
  // candidate flows back via onSelect. The low-res filter is lifted here so
  // the panel can render its inline toggle while the upload modal renders
  // an external one — both follow the same controlled-prop API.
  const defaultQuery = useMemo(() => deriveDefaultQuery(target), [target]);
  const [hideSmallerResults, setHideSmallerResults] = useState(true);

  const [urlInput, setUrlInput] = useState('');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  // AI-upscale tab state
  const [upscalerInfo, setUpscalerInfo] = useState<UpscalerInfo | null>(null);
  const [aiModel, setAiModel] = useState<UpscaleModel>('ultramix_balanced');
  // "auto" picks the smallest scale from the catalog that lifts the image
  // above the largest render box across all games (1920×648 — image-guess
  // game; quiz games use 1920×540 which is the smaller constraint).
  // Default for low-res images = auto. Users can override to a fixed scale.
  const [aiScaleChoice, setAiScaleChoice] = useState<UpscaleScale | 'auto'>('auto');

  // Resolve "auto" to the smallest scale in the catalog that lifts the
  // source above 1920×648 (any one axis is enough — same predicate as the
  // "Niedrige Auflösung" filter). When dims are unknown, fall back to 4×.
  const resolveAutoScale = (dims?: { w: number; h: number } | null): UpscaleScale => {
    if (!dims) return 4;
    for (const s of UPSCALE_SCALES) {
      if (dims.w * s >= 1920 || dims.h * s >= 648) return s;
    }
    return UPSCALE_SCALES[UPSCALE_SCALES.length - 1]!;
  };
  const resolvedAiScale: UpscaleScale = aiScaleChoice === 'auto'
    ? resolveAutoScale(currentDims)
    : aiScaleChoice;
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // null = SSE not yet emitting (binary still spawning, or cache hit).
  // 0..100 = AI tile progress percent reported by upscayl-ncnn stderr.
  const [aiProgress, setAiProgress] = useState<number | null>(null);
  // Per-(model, scale) cache of AI runs the user has produced in THIS
  // modal session. Keyed by `${model}-${scale}`. When the user switches
  // dropdowns back to a combo they've already generated, we auto-restore
  // the candidate (preview updates, run button hides) — so the AI tab
  // remembers every result without the user having to re-click.
  const [aiCache, setAiCache] = useState<Record<string, AiCandidate>>({});
  const [dryRun, setDryRun] = useState<ImageReplaceResult | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [smallerWarning, setSmallerWarning] = useState<{ oldDims: { w: number; h: number }; newDims: { w: number; h: number } } | null>(null);
  const [vectorRasterWarning, setVectorRasterWarning] = useState<{ oldExt: string; newExt: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Side-by-side enlargement holds BOTH images plus which view is active so
  // the user can flick between them with floating arrows or ← / → keys to
  // compare at identical display size. `stage.w` and `stage.h` are the
  // computed display dimensions of the lightbox box (taken from the larger
  // image's natural dims, fit within the viewport). Storing them inline
  // lets us avoid CSS aspect-ratio + max-* fights — both images render at
  // 100% × 100% of this fixed box.
  const [enlarged, setEnlarged] = useState<{
    before: { src: string; name: string };
    after: { src: string; name: string };
    view: 'before' | 'after';
    stage: { w: number; h: number };
  } | null>(null);

  const dropzoneRef = useRef<HTMLDivElement>(null);
  // Ref to the comparison row so a successful AI run can scroll it into
  // view — important on small viewports where the preview pane sits below
  // the fold after the controls and dropdowns push it down.
  const compareRef = useRef<HTMLDivElement>(null);

  // Probe upscaler availability on mount. Cached for the modal's lifetime.
  useEffect(() => {
    let cancelled = false;
    fetchUpscalerInfo()
      .then(info => { if (!cancelled) setUpscalerInfo(info); })
      .catch(() => { if (!cancelled) setUpscalerInfo({ available: false, models: [], scales: [], supportedExts: [] }); });
    return () => { cancelled = true; };
  }, []);

  // Auto-restore a cached AI result when the user changes the model/scale
  // dropdown back to a combo they've already generated in this session.
  // Without this, switching to ultrasharp and back to ultramix would still
  // show ultrasharp's stale preview + the run button — even though the
  // ultramix result was already computed. With this, the preview swaps
  // to the cached entry and the run button hides automatically.
  useEffect(() => {
    if (tab !== 'ai') return;
    const key = `${aiModel}-${resolvedAiScale}`;
    const hit = aiCache[key];
    if (!hit) return;
    // Already showing this exact combo — nothing to do.
    if (candidate?.type === 'ai' && candidate.ai?.model === aiModel && candidate.ai?.scale === resolvedAiScale) return;
    setCandidate({ type: 'ai', previewUrl: hit.previewUrl ?? '', ai: hit });
    setDryRun({
      success: true,
      target,
      newFilename: target,
      newDims: hit.newDims,
      oldSize: currentSizeBytes ?? 0,
      newSize: hit.newSize,
      extensionChanged: false,
      rewrittenGames: 0,
      backupPath: '',
      version: 0,
      ...(currentDims ? { oldDims: currentDims } : {}),
    });
  }, [tab, aiModel, resolvedAiScale, aiCache, candidate, target, currentDims, currentSizeBytes]);

  useEffect(() => {
    if (!enlarged) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setEnlarged(null);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        setEnlarged(prev => prev ? { ...prev, view: 'before' } : prev);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        setEnlarged(prev => prev ? { ...prev, view: 'after' } : prev);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [enlarged]);

  // Revoke any object URLs we created when the candidate changes or unmounts.
  useEffect(() => {
    return () => {
      if (candidate?.type === 'file' && candidate.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(candidate.previewUrl);
      }
    };
  }, [candidate]);

  const clearCandidate = useCallback(() => {
    setCandidate(prev => {
      if (prev?.type === 'file' && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
    setDryRun(null);
    setDryRunError(null);
    setSmallerWarning(null);
    setVectorRasterWarning(null);
    setSubmitError(null);
  }, []);

  const pickCandidate = useCallback((next: Candidate) => {
    setCandidate(prev => {
      if (prev?.type === 'file' && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return next;
    });
    setDryRun(null);
    setDryRunError(null);
    setSmallerWarning(null);
    setVectorRasterWarning(null);
    setSubmitError(null);
  }, []);

  // Trigger a dryRun whenever a new candidate is picked.
  // AI candidates are skipped — the AI run handler primes dryRun directly.
  useEffect(() => {
    if (!candidate || candidate.type === 'ai') return;
    let cancelled = false;
    (async () => {
      setDryRun(null);
      setDryRunError(null);
      setSmallerWarning(null);
      setVectorRasterWarning(null);
      try {
        let resp: ImageReplaceResponse;
        if (candidate.type === 'file' && candidate.file) {
          resp = await replaceImageFromFile(target, candidate.file, { dryRun: true });
        } else if ((candidate.type === 'url' || candidate.type === 'search') && (candidate.url || candidate.search?.url)) {
          resp = await replaceImageFromUrl(target, (candidate.url || candidate.search!.url)!, { dryRun: true });
        } else {
          return;
        }
        if (cancelled) return;
        if ('noChange' in resp) {
          setDryRunError('Identischer Inhalt — Bytes sind gleich.');
          return;
        }
        setDryRun(resp);
      } catch (err) {
        if (cancelled) return;
        // Both smaller-image and vector-raster mismatches are recoverable 409s;
        // the structured body carries everything we need to offer "Trotzdem
        // ersetzen" without parsing the message.
        if (err instanceof ApiError) {
          const body = err.body as {
            error?: string;
            oldDims?: { w: number; h: number };
            newDims?: { w: number; h: number };
            oldExt?: string;
            newExt?: string;
          };
          if (body?.error === 'smaller' && body.oldDims && body.newDims) {
            setSmallerWarning({ oldDims: body.oldDims, newDims: body.newDims });
            return;
          }
          if (body?.error === 'vector_raster_mismatch' && body.oldExt && body.newExt) {
            setVectorRasterWarning({ oldExt: body.oldExt, newExt: body.newExt });
            return;
          }
        }
        setDryRunError((err as Error).message || 'Vorschau fehlgeschlagen.');
      }
    })();
    return () => { cancelled = true; };
  }, [candidate, target]);

  const handleUrlPick = useCallback(() => {
    if (!urlInput.trim()) return;
    pickCandidate({ type: 'url', url: urlInput.trim(), previewUrl: urlInput.trim() });
  }, [urlInput, pickCandidate]);

  const handleFile = useCallback((file: File) => {
    const previewUrl = URL.createObjectURL(file);
    pickCandidate({ type: 'file', file, previewUrl });
  }, [pickCandidate]);

  // The replace endpoint keeps the target's existing basename, so the search
  // term is intentionally ignored here. Clicking the already-selected
  // candidate deselects it (toggle), so the user can back out of a pick
  // without committing to one of the other results.
  const handleSearchPick = useCallback((r: ImageSearchResult, _query: string) => {
    if (candidate?.type === 'search' && candidate.search?.url === r.url) {
      clearCandidate();
      return;
    }
    pickCandidate({ type: 'search', search: r, previewUrl: r.thumbnailUrl || r.url });
  }, [candidate, pickCandidate, clearCandidate]);

  // Submitting a new search invalidates any current search-pick — the chosen
  // candidate may not even appear in the new result set.
  const handleSearchSubmit = useCallback(() => {
    if (candidate?.type === 'search') clearCandidate();
  }, [candidate, clearCandidate]);

  // AI upscale — explicit "Vorschau erstellen" trigger.
  const handleAiRun = useCallback(async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiProgress(null);
    clearCandidate();
    // Generate a per-run progress id, open the SSE stream BEFORE the POST so
    // the server-side listener is already registered by the time the first
    // tile completes. EventSource is closed in the finally below. Guarded
    // for non-browser test environments where `EventSource` is absent.
    const progressId = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0')}`;
    const es: EventSource | null = typeof EventSource !== 'undefined'
      ? new EventSource(upscaleProgressUrl(progressId))
      : null;
    if (es) {
      es.onmessage = (ev) => {
        try {
          const { percent } = JSON.parse(ev.data) as { percent?: number };
          if (typeof percent === 'number' && percent >= 0 && percent <= 100) {
            setAiProgress(percent);
          }
        } catch { /* ignore malformed events */ }
      };
    }
    try {
      const resp = await upscaleImageDryRun(target, aiModel, resolvedAiScale, progressId);
      const ai = {
        model: aiModel,
        scale: resolvedAiScale,
        newDims: resp.newDims,
        newSize: resp.newSize,
        durationMs: resp.durationMs,
        cacheKey: resp.cacheKey,
      };
      setCandidate({ type: 'ai', previewUrl: resp.previewUrl, ai });
      // Remember this result for the session so a later dropdown switch
      // back to (model, scale) auto-restores it without a re-run.
      setAiCache(prev => ({ ...prev, [`${aiModel}-${resolvedAiScale}`]: { ...ai, previewUrl: resp.previewUrl } }));
      // Prime the shared dry-run state so the existing compare pane and
      // confirm button light up the same way the replace flow does.
      setDryRun({
        success: true,
        target,
        newFilename: target,
        newDims: resp.newDims,
        oldSize: currentSizeBytes ?? 0,
        newSize: resp.newSize,
        extensionChanged: false,
        rewrittenGames: 0,
        backupPath: '',
        version: 0,
        ...(currentDims ? { oldDims: currentDims } : {}),
      });
      // Defer the scroll one frame so the new compare row is in the DOM.
      // This is the primary user-feedback that the click registered, even
      // for byte-identical cache hits.
      requestAnimationFrame(() => {
        compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string };
        if (body?.error === 'not_installed') {
          setAiError('AI-Upscaler nicht installiert. `npm run upscaler:install` ausführen.');
        } else if (body?.error === 'vulkan_missing') {
          setAiError(body.message || 'Vulkan-Treiber fehlen — sudo apt install libvulkan1 mesa-vulkan-drivers');
        } else {
          setAiError(body?.message || (err as Error).message);
        }
      } else {
        setAiError((err as Error).message || 'Upscaling fehlgeschlagen.');
      }
    } finally {
      es?.close();
      setAiBusy(false);
      setAiProgress(null);
    }
  }, [aiBusy, aiModel, resolvedAiScale, target, clearCandidate, currentDims, currentSizeBytes]);

  // Mount document-level paste listener while the modal is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            // Block the global DAM paste-to-upload handler from also firing.
            e.stopImmediatePropagation();
            e.preventDefault();
            handleFile(f);
            return;
          }
        }
      }
    };
    // useCapture: true so we run before the global handler attached on document.
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [handleFile]);

  // Drag-and-drop on the dropzone.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  }, [handleFile]);

  const onConfirm = useCallback(async (force = false) => {
    if (!candidate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let resp: ImageReplaceResponse;
      if (candidate.type === 'ai' && candidate.ai) {
        resp = await upscaleImageConfirm(target, candidate.ai.model, candidate.ai.scale);
      } else if (candidate.type === 'file' && candidate.file) {
        resp = await replaceImageFromFile(target, candidate.file, { force });
      } else if ((candidate.type === 'url' || candidate.type === 'search') && (candidate.url || candidate.search?.url)) {
        resp = await replaceImageFromUrl(target, (candidate.url || candidate.search!.url)!, { force });
      } else {
        return;
      }
      if ('noChange' in resp) {
        setSubmitError('Identischer Inhalt — Bytes sind gleich.');
        return;
      }
      onReplaced(resp);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [candidate, onReplaced, target]);

  const headerSummary = useMemo(() => {
    const parts = [target.split('/').pop() || target];
    if (currentDims) parts.push(fmtDims(currentDims));
    if (currentSizeBytes) parts.push(fmtBytes(currentSizeBytes));
    return parts.join('  ·  ');
  }, [target, currentDims, currentSizeBytes]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="replace-modal" onClick={e => e.stopPropagation()}>
        <div className="replace-modal-header">
          <span className="replace-modal-title">Bild ersetzen</span>
          <span className="replace-modal-subtitle">{headerSummary}</span>
          <button className="be-icon-btn" onClick={onCancel} aria-label="Schließen">✕</button>
        </div>
        <div className="replace-modal-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'search'}
            className={`replace-modal-tab${tab === 'search' ? ' is-active' : ''}`}
            onClick={() => setTab('search')}
          >Suchen</button>
          <button
            role="tab"
            aria-selected={tab === 'url'}
            className={`replace-modal-tab${tab === 'url' ? ' is-active' : ''}`}
            onClick={() => setTab('url')}
          >URL einfügen</button>
          <button
            role="tab"
            aria-selected={tab === 'file'}
            className={`replace-modal-tab${tab === 'file' ? ' is-active' : ''}`}
            onClick={() => setTab('file')}
          >Datei / Einfügen</button>
          <button
            role="tab"
            aria-selected={tab === 'ai'}
            className={`replace-modal-tab${tab === 'ai' ? ' is-active' : ''}`}
            onClick={() => setTab('ai')}
          >AI hochskalieren</button>
        </div>

        <div className="replace-modal-body">
          {tab === 'search' && (
            <>
              <ImageSearchPanel
                defaultQuery={defaultQuery}
                renderBox={renderBox}
                selectedUrl={candidate?.search?.url}
                onSelect={handleSearchPick}
                onSearch={handleSearchSubmit}
                hideSmallerResults={hideSmallerResults}
                onHideSmallerResultsChange={setHideSmallerResults}
              />
              <div className="replace-paste-hint">Tipp: Bild mit Strg+V direkt einfügen.</div>
            </>
          )}

          {tab === 'url' && (
            <div className="replace-url">
              <label className="replace-url-label">
                Bild-URL einfügen:
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://…"
                  className="replace-url-input"
                />
              </label>
              <button
                type="button"
                className="be-btn-primary"
                onClick={handleUrlPick}
                disabled={!urlInput.trim()}
              >Vorschau</button>
              <div className="replace-url-hint">
                Google- oder Bing-Suchergebnis-Links werden serverseitig entpackt.
              </div>
              <div className="replace-paste-hint">Tipp: Bild mit Strg+V direkt einfügen.</div>
            </div>
          )}

          {tab === 'file' && (
            <div className="replace-file">
              <div
                ref={dropzoneRef}
                className="replace-dropzone"
                onDragOver={onDragOver}
                onDrop={onDrop}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = () => { if (input.files?.[0]) handleFile(input.files[0]); };
                  input.click();
                }}
              >
                <span>Bild hierher ziehen, klicken zum Auswählen, oder Strg+V zum Einfügen</span>
              </div>
              <div className="replace-paste-hint">Tipp: Bild mit Strg+V direkt einfügen.</div>
            </div>
          )}

          {tab === 'ai' && (() => {
            const targetExt = (target.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
            const isSvg = targetExt === '.svg';
            const isGif = targetExt === '.gif';
            const unsupportedFormat = !UPSCALE_SUPPORTED_EXTS.includes(targetExt);
            const alreadyLarge = !!(currentDims && renderBox &&
              currentDims.w >= renderBox.w && currentDims.h >= renderBox.h);
            const lowerTarget = target.toLowerCase();
            const looksLikeTextHeavy = lowerTarget.startsWith('logos/') || lowerTarget.startsWith('computerspiele/');
            const aiAvailable = upscalerInfo?.available === true;
            // Mirror server-side `predictOutputDims` in server/upscale.ts:
            // the upscaler honours the requested scale exactly — no envelope
            // clamp. `2×` doubles every dimension, `4×` quadruples them.
            const predictedW = currentDims ? currentDims.w * resolvedAiScale : null;
            const predictedH = currentDims ? currentDims.h * resolvedAiScale : null;
            const disabled = aiBusy || !aiAvailable || isSvg || isGif || unsupportedFormat;
            // If the current candidate is an AI upscale at the exact model
            // + scale the user has selected, hide the run button entirely
            // — the preview already shows what they'd get, and a re-click
            // would only return the cached bytes (no visible change).
            // Changing either dropdown brings the button back.
            const aiCandidateMatchesSelection = !!(
              candidate?.type === 'ai' &&
              candidate.ai &&
              candidate.ai.model === aiModel &&
              candidate.ai.scale === resolvedAiScale
            );

            return (
              <div className="replace-ai">
                {isSvg && (
                  <div className="replace-warning">
                    Vektorgrafiken werden nicht hochskaliert — kein AI nötig.
                  </div>
                )}
                {isGif && (
                  <div className="replace-warning">
                    Animierte Bilder werden nicht unterstützt.
                  </div>
                )}
                {!isSvg && !isGif && unsupportedFormat && (
                  <div className="replace-warning">
                    Format wird nicht unterstützt. Erlaubt: {UPSCALE_SUPPORTED_EXTS.join(', ')}.
                  </div>
                )}
                {!disabled && alreadyLarge && (
                  <div className="replace-warning">
                    Das Bild ist bereits hoch genug aufgelöst. Upscaling wahrscheinlich unnötig.
                  </div>
                )}
                {!disabled && looksLikeTextHeavy && (
                  <div className="replace-warning">
                    Text und Logos können durch AI-Upscaling verschlechtert werden. Vorschau prüfen.
                  </div>
                )}
                {upscalerInfo && !aiAvailable && (
                  <div className="replace-warning">
                    AI-Upscaler nicht installiert. <code>npm run upscaler:install</code> ausführen.
                  </div>
                )}

                <div className="replace-ai-controls">
                  <label className="replace-ai-field">
                    Modell
                    <select
                      value={aiModel}
                      onChange={e => setAiModel(e.target.value as UpscaleModel)}
                      disabled={disabled}
                    >
                      {(['ultramix_balanced', 'ultrasharp', 'digital_art'] as const).map(m => (
                        <option key={m} value={m}>{AI_MODEL_LABELS[m]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="replace-ai-field">
                    Skalierung
                    <select
                      value={aiScaleChoice}
                      onChange={e => {
                        const v = e.target.value;
                        setAiScaleChoice(v === 'auto' ? 'auto' : (Number(v) as UpscaleScale));
                      }}
                      disabled={disabled}
                    >
                      <option value="auto">Auto — optimal für alle Spiele (empfohlen)</option>
                      {UPSCALE_SCALES.map(s => (
                        <option key={s} value={s}>{formatScaleLabel(s)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="replace-ai-prediction">
                  {currentDims && predictedW && predictedH
                    ? `Aktuell: ${currentDims.w}×${currentDims.h}px → vorhergesagt: ${predictedW}×${predictedH}px${aiScaleChoice === 'auto' ? ` (Auto → ${formatScaleNumber(resolvedAiScale)}×)` : ''}`
                    : 'Aktuell: unbekannt'}
                </div>

                {!aiCandidateMatchesSelection && (
                  <button
                    type="button"
                    className="be-btn-primary"
                    onClick={() => handleAiRun()}
                    disabled={disabled}
                  >
                    {aiBusy ? 'Wird hochskaliert…' : 'Vorschau erstellen'}
                  </button>
                )}

                {aiBusy && (
                  <div className="replace-ai-progress">
                    {/* Indeterminate look until the AI fires its first tile,
                        then determinate once we receive a percent. */}
                    {aiProgress != null ? (
                      <>
                        <progress className="replace-ai-progress-bar" value={aiProgress} max={100} />
                        <span className="replace-ai-progress-pct">{Math.round(aiProgress)}%</span>
                      </>
                    ) : (
                      <>
                        <progress className="replace-ai-progress-bar" />
                        <span className="replace-ai-progress-pct">Starte…</span>
                      </>
                    )}
                  </div>
                )}

                <div className="replace-paste-hint">
                  AI-Upscaling läuft lokal und dauert 3-8 Sek.
                </div>

                {aiError && <div className="replace-error">{aiError}</div>}
              </div>
            );
          })()}
        </div>

        {/* Comparison + dry-run preview */}
        {candidate && (() => {
          const targetName = target.split('/').pop() || target;
          const currentSrc = assetUrl('images', target);
          // For enlargement prefer the original full-resolution URL over the
          // thumbnail that drives the small comparison preview.
          const newFullSrc = candidate.search?.url || candidate.url || candidate.previewUrl;
          const newName =
            candidate.type === 'file' ? candidate.file?.name || 'Neues Bild'
            : candidate.search?.title || targetName;
          // Compute the lightbox stage dimensions: anchor to the larger image,
          // scale-to-fit within 85vw × (90vh - 160px) preserving aspect.
          // Fallback (no dims known yet): roughly 16:9 within the same caps.
          const computeStage = (): { w: number; h: number } => {
            const a = currentDims && currentDims.w > 0 ? currentDims : null;
            const b = dryRun?.newDims && dryRun.newDims.w > 0 ? dryRun.newDims : null;
            const bigger = (a && b)
              ? (a.w * a.h >= b.w * b.h ? a : b)
              : (a || b);
            // The lightbox itself is `min(90vw, 1400px)` with horizontal
            // padding for the floating arrows — see .image-lightbox--compare
            // and .image-lightbox-body--compare in backend.css. Subtract the
            // arrow + padding budget so the stage never overflows. The
            // padding values mirror the responsive CSS breakpoints so the
            // stage matches the available room at every width.
            const iw = window.innerWidth;
            const ih = window.innerHeight;
            const padX = iw <= 480 ? 88 : iw <= 768 ? 112 : 128;
            const maxW = Math.min(iw * 0.9, 1400) - padX;
            const maxH = Math.min(ih * 0.9 - 160, 1400);
            if (!bigger) {
              return { w: Math.max(160, Math.min(1280, maxW)), h: Math.max(120, Math.min(720, maxH)) };
            }
            const scale = Math.min(maxW / bigger.w, maxH / bigger.h, 1);
            return {
              w: Math.max(160, Math.round(bigger.w * scale)),
              h: Math.max(120, Math.round(bigger.h * scale)),
            };
          };
          const openCompare = (view: 'before' | 'after') => setEnlarged({
            before: { src: currentSrc, name: targetName },
            after: { src: newFullSrc, name: newName },
            view,
            stage: computeStage(),
          });
          return (
            <div className="replace-compare" ref={compareRef}>
              <div className="replace-compare-pane">
                <div className="replace-compare-label">Aktuell</div>
                <img
                  src={currentSrc}
                  alt="aktuell"
                  className="replace-compare-img"
                  onClick={() => openCompare('before')}
                  title="Größer anzeigen (← / → zum Vergleichen)"
                />
                <div className="replace-compare-meta">{fmtDims(currentDims)} · {fmtBytes(currentSizeBytes)}</div>
              </div>
              <div className="replace-compare-arrow" aria-hidden>→</div>
              <div className="replace-compare-pane">
                <div className="replace-compare-label">Neu</div>
                <img
                  src={candidate.previewUrl}
                  alt="neu"
                  referrerPolicy="no-referrer"
                  className="replace-compare-img"
                  onClick={() => openCompare('after')}
                  title="Größer anzeigen (← / → zum Vergleichen)"
                />
                <div className="replace-compare-meta">
                  {dryRun ? `${fmtDims(dryRun.newDims)} · ${fmtBytes(dryRun.newSize)}` : (smallerWarning ? fmtDims(smallerWarning.newDims) : 'Lade Vorschau…')}
                </div>
                {dryRun?.extensionChanged && (
                  <div className="replace-extension-warning">
                    ⚠ Format ändert sich. {dryRun.rewrittenGames > 0 ? `Spielreferenzen werden aktualisiert.` : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {enlarged && createPortal(
          (() => {
            const active = enlarged[enlarged.view];
            return (
              <div className="modal-overlay" onClick={() => setEnlarged(null)}>
                <div className="image-lightbox image-lightbox--compare" onClick={e => e.stopPropagation()}>
                  <div className="image-lightbox-header">
                    <span className="image-lightbox-name">
                      🖼 {enlarged.view === 'before' ? 'Aktuell' : 'Neu'} — {active.name}
                    </span>
                    <button className="be-icon-btn" onClick={() => setEnlarged(null)} aria-label="Schließen">✕</button>
                  </div>
                  <div className="image-lightbox-body image-lightbox-body--compare">
                    <button
                      type="button"
                      className="image-lightbox-nav image-lightbox-nav--prev"
                      onClick={() => setEnlarged(prev => prev ? { ...prev, view: 'before' } : prev)}
                      aria-label="Aktuell anzeigen (Pfeil links)"
                      aria-pressed={enlarged.view === 'before'}
                    >‹</button>
                    {/*
                      Stage uses aspect-ratio from the larger image's dims so its size is
                      stable when toggling between views. Both <img>s are absolutely
                      stacked inside the stage at 100% × 100% with object-fit: contain.
                    */}
                    <div
                      className="image-lightbox-stage"
                      style={{ width: `${enlarged.stage.w}px`, height: `${enlarged.stage.h}px` }}
                    >
                      <img
                        src={enlarged.before.src}
                        alt={enlarged.before.name}
                        referrerPolicy="no-referrer"
                        className={`image-lightbox-stage-img${enlarged.view === 'before' ? ' is-active' : ''}`}
                      />
                      <img
                        src={enlarged.after.src}
                        alt={enlarged.after.name}
                        referrerPolicy="no-referrer"
                        className={`image-lightbox-stage-img${enlarged.view === 'after' ? ' is-active' : ''}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="image-lightbox-nav image-lightbox-nav--next"
                      onClick={() => setEnlarged(prev => prev ? { ...prev, view: 'after' } : prev)}
                      aria-label="Neu anzeigen (Pfeil rechts)"
                      aria-pressed={enlarged.view === 'after'}
                    >›</button>
                  </div>
                  <div className="image-lightbox-footer">
                    <span className={`image-lightbox-toggle${enlarged.view === 'before' ? ' is-active' : ''}`}>Aktuell</span>
                    <span className="image-lightbox-toggle-sep">·</span>
                    <span className={`image-lightbox-toggle${enlarged.view === 'after' ? ' is-active' : ''}`}>Neu</span>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body,
        )}

        {dryRunError && <div className="replace-error">{dryRunError}</div>}
        {smallerWarning && (
          <div className="replace-warning">
            Neues Bild ist kleiner ({fmtDims(smallerWarning.newDims)}) als das aktuelle ({fmtDims(smallerWarning.oldDims)}).
          </div>
        )}
        {vectorRasterWarning && (() => {
          const oldLabel = vectorRasterWarning.oldExt.replace(/^\./, '').toUpperCase();
          const newLabel = vectorRasterWarning.newExt.replace(/^\./, '').toUpperCase();
          const newIsSvg = vectorRasterWarning.newExt === '.svg';
          return (
            <div className="replace-warning">
              Format ändert sich: {oldLabel} → {newLabel}.
              {newIsSvg
                ? ' Vorteil: unbegrenzte Skalierbarkeit. Spielreferenzen werden aktualisiert.'
                : ' Hinweis: Skalierbarkeit geht verloren. Spielreferenzen werden aktualisiert.'}
            </div>
          );
        })()}
        {submitError && <div className="replace-error">{submitError}</div>}

        <div className="replace-modal-actions">
          <button className="be-btn-secondary" onClick={onCancel} disabled={submitting}>Abbrechen</button>
          {smallerWarning ? (
            <button
              className="be-btn-warning"
              onClick={() => onConfirm(true)}
              disabled={!candidate || submitting}
            >
              {submitting ? 'Ersetze…' : 'Trotzdem ersetzen — neues Bild ist kleiner'}
            </button>
          ) : vectorRasterWarning ? (
            <button
              className="be-btn-warning"
              onClick={() => onConfirm(true)}
              disabled={!candidate || submitting}
            >
              {submitting ? 'Ersetze…' : `Trotzdem ersetzen — ${vectorRasterWarning.oldExt.replace(/^\./, '').toUpperCase()} → ${vectorRasterWarning.newExt.replace(/^\./, '').toUpperCase()}`}
            </button>
          ) : (
            <button
              className="be-btn-primary"
              onClick={() => onConfirm(false)}
              disabled={!candidate || submitting || !!dryRunError}
            >
              {submitting ? 'Ersetze…' : '✓ Ersetzen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
