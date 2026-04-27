import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    }, dismissMs);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, dismissMs + EXIT_ANIMATION_MS);
  }, [message]);

  if (toasts.length === 0) return null;

  const dismissToast = (id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, EXIT_ANIMATION_MS);
  };

  return createPortal(
    <div className="be-toast-container">
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
    </div>,
    document.body,
  );
}
