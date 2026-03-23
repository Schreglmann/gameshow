import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Toast {
  id: number;
  type: 'success' | 'error';
  text: string;
  exiting: boolean;
}

let nextId = 0;

interface Props {
  message: { type: 'success' | 'error'; text: string } | null;
}

export default function StatusMessage({ message }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!message) return;

    const id = nextId++;
    setToasts(prev => [...prev, { id, type: message.type, text: message.text, exiting: false }]);

    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    }, 2200);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  }, [message]);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="be-toast-container">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`be-toast be-toast-${toast.type}${toast.exiting ? ' be-toast-exit' : ''}`}
        >
          {toast.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
