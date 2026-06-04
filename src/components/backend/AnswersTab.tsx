import { useState } from 'react';
import GamemasterQrModal from './GamemasterQrModal';
import '@/styles/gamemaster.css';

export default function AnswersTab() {
  const [showQr, setShowQr] = useState(false);

  return (
    <div className="answers-tab">
      <div className="answers-tab-header">
        <button
          type="button"
          className="answers-tab-fullscreen"
          onClick={() => setShowQr(true)}
        >
          QR-Code
        </button>
        <a
          href="/gamemaster"
          target="_blank"
          rel="noopener noreferrer"
          className="answers-tab-fullscreen"
        >
          Vollbild öffnen
        </a>
      </div>
      <iframe
        src="/gamemaster"
        className="answers-tab-iframe"
        title="Gamemaster"
      />
      {showQr && <GamemasterQrModal onClose={() => setShowQr(false)} />}
    </div>
  );
}
