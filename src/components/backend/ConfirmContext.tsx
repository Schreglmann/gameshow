import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import ConfirmModal, { type ConfirmOptions } from './ConfirmModal';

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const pendingRef = useRef<PendingState | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback<ConfirmFn>(options => {
    // If a previous confirm is still open, resolve it as cancelled before
    // replacing it — otherwise its caller's promise would never settle.
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
    }
    return new Promise<boolean>(resolve => {
      setPending({ options, resolve });
    });
  }, []);

  const settle = (value: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    setPending(null);
    current.resolve(value);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmModal
          {...pending.options}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  // Fall back to window.confirm when no provider is mounted — covers unit-test
  // rendering of admin components in isolation (those tests stub window.confirm).
  // Production admin always wraps with <ConfirmProvider>, so the modal path wins.
  if (!ctx) return options => Promise.resolve(window.confirm(options.title));
  return ctx;
}
