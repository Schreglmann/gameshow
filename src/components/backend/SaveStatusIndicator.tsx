import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSaveQueueStatus } from '@/services/useSaveQueueStatus';
import { retryNow } from '@/services/saveQueue';
import SaveStatusToast, { type SaveStatusVariant } from './SaveStatusToast';
import { getToastRoot } from './toastRoot';

const SAVED_FLASH_MS = 2500;
/** Below this, a save is not worth announcing — it is over before it registers. */
const SAVING_VISIBLE_AFTER_MS = 500;

/**
 * The admin shell's save status — see specs/admin-save-queue.md.
 *
 * Mounted once, outside every tab pane, because the whole point is to keep
 * reporting after the pane that queued the write has unmounted. It renders into
 * the shared bottom-right toast stack, so it is the same box every other admin
 * message uses.
 */
export default function SaveStatusIndicator() {
  const status = useSaveQueueStatus();
  const [flashSaved, setFlashSaved] = useState(false);
  const [slowSave, setSlowSave] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prevSavedAt = useRef(status.lastSavedAt);

  // Flash "Gespeichert" when a write actually reaches disk. Keyed on `lastSavedAt`
  // rather than on the queue going empty, so discarding a queued save (deleting the
  // game it belonged to) does not claim it was saved.
  useEffect(() => {
    const changed = status.lastSavedAt !== prevSavedAt.current;
    prevSavedAt.current = status.lastSavedAt;
    if (!changed || status.lastSavedAt === null) return;
    setFlashSaved(true);
    const t = setTimeout(() => setFlashSaved(false), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [status.lastSavedAt]);

  // Announce the write only once it is slow enough to be worth a message. A save
  // that lands in a few dozen ms would otherwise flicker past on every keystroke.
  useEffect(() => {
    if (!status.inFlight) { setSlowSave(false); return; }
    const t = setTimeout(() => setSlowSave(true), SAVING_VISIBLE_AFTER_MS);
    return () => clearTimeout(t);
  }, [status.inFlight]);

  // The countdown ticks here rather than in the store, so a retry pending in the
  // background does not re-render every save-queue consumer once a second.
  const retrying = status.state === 'retrying' && status.nextRetryAt !== null;
  useEffect(() => {
    if (!retrying) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => clearInterval(id);
  }, [retrying]);

  let variant: SaveStatusVariant;
  let text: string;
  let action: { label: string; onClick: () => void } | undefined;

  if (status.state === 'error') {
    variant = 'error';
    text = `❌ Speichern fehlgeschlagen: ${status.lastError ?? 'unbekannter Fehler'}`;
    action = { label: 'Erneut versuchen', onClick: () => retryNow() };
  } else if (status.offline && status.unsavedKeys > 0) {
    variant = 'offline';
    text = 'Offline – Änderungen werden gespeichert, sobald die Verbindung zurück ist';
  } else if (retrying) {
    const secs = Math.max(1, Math.ceil(((status.nextRetryAt as number) - now) / 1000));
    variant = 'retrying';
    text = `Speichern fehlgeschlagen – erneuter Versuch in ${secs} s`;
    action = { label: 'Jetzt versuchen', onClick: () => retryNow() };
  } else if (slowSave) {
    variant = 'saving';
    text = 'Speichern…';
  } else if (flashSaved) {
    variant = 'saved';
    text = '✅ Gespeichert!';
  } else {
    return null;
  }

  return createPortal(
    <SaveStatusToast variant={variant} text={text} action={action} />,
    getToastRoot(),
  );
}
