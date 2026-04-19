import { useEffect, useRef, useState } from 'react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import '@/styles/install-button.css';

export interface InstallButtonProps {
  variant?: 'frontend' | 'admin' | 'gamemaster';
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

export default function InstallButton({
  variant = 'frontend',
  label = 'App installieren',
  className = '',
  style,
  onClick,
}: InstallButtonProps) {
  const { canInstall, browser, prompt } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHint) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setShowHint(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showHint]);

  if (!canInstall) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e);
    const result = await prompt();
    if (result === 'manual') setShowHint((v) => !v);
  };

  return (
    <div
      className={`install-button-wrapper install-button-wrapper--${variant}`}
      ref={wrapperRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`install-button install-button--${variant} ${className}`.trim()}
        style={style}
        onClick={handleClick}
        aria-label={label}
        aria-expanded={showHint || undefined}
      >
        <span aria-hidden="true" className="install-button-icon">⤓</span>
        <span>{label}</span>
      </button>
      {showHint && browser.manualInstructions && (
        <div className="install-hint" role="dialog" aria-label="Installationsanleitung">
          {browser.manualInstructions}
          <button
            type="button"
            className="install-hint-close"
            onClick={(e) => { e.stopPropagation(); setShowHint(false); }}
            aria-label="Schließen"
          >×</button>
        </div>
      )}
    </div>
  );
}
