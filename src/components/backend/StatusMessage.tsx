import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getToastRoot } from './toastRoot';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  type: 'success' | 'error';
  text: string;
  action?: ToastAction;
}

interface Toast {
  id: number;
  type: 'success' | 'error';
  text: string;
  action?: ToastAction;
  exiting: boolean;
}

let nextId = 0;

interface Props {
  message: ToastMessage | null;
}

const DISMISS_DEFAULT_MS = 2200;
const DISMISS_WITH_ACTION_MS = 8000;
const EXIT_ANIMATION_MS = 300;

export default function StatusMessage({ message }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Every dismiss timer is tracked so unmount can cancel it. A toast's timers
  // deliberately outlive the `message` effect that scheduled them (a newer
  // message must not freeze an older toast on screen), so they can only be
  // cleared on unmount — otherwise they fire into an unmounted component,
  // which in vitest surfaces as "window is not defined" after jsdom teardown.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const schedule = useCallback((fn: () => void, ms: number) => {
    const timers = timersRef.current;
    const handle = setTimeout(() => {
      timers.delete(handle);
      fn();
    }, ms);
    timers.add(handle);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!message) return;

    const id = nextId++;
    setToasts(prev => [...prev, {
      id,
      type: message.type,
      text: message.text,
      action: message.action,
      exiting: false,
    }]);

    const dismissMs = message.action ? DISMISS_WITH_ACTION_MS : DISMISS_DEFAULT_MS;
    schedule(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    }, dismissMs);

    schedule(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, dismissMs + EXIT_ANIMATION_MS);
  }, [message, schedule]);

  if (toasts.length === 0) return null;

  const dismissToast = (id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    schedule(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, EXIT_ANIMATION_MS);
  };

  // Into the shared container, so a pane toast and the shell's save status stack
  // instead of overlapping in the same corner.
  return createPortal(
    <>
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`be-toast be-toast-${toast.type}${toast.exiting ? ' be-toast-exit' : ''}`}
        >
          <span className="be-toast-text">{toast.text}</span>
          {toast.action && (
            <button
              className="be-toast-action"
              onClick={() => {
                toast.action?.onClick();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </>,
    getToastRoot(),
  );
}
