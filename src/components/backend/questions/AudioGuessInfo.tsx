interface Props {
  onGoToAssets: () => void;
}

export default function AudioGuessInfo({ onGoToAssets }: Props) {
  return (
    <div className="backend-card" style={{ borderColor: 'rgba(102, 126, 234, 0.3)' }}>
      <h3 style={{ marginTop: 0 }}>Fragen werden dynamisch geladen</h3>
      <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        Audio-Guess Fragen werden automatisch aus dem Dateisystem generiert.
        Jeder Unterordner in <code>/audio-guess/</code> wird zu einer Frage.
        Der Ordnername wird als Antwort verwendet (Präfix <code>Beispiel_</code> markiert Beispielfragen).
      </p>
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
        Dateistruktur: <code>/audio-guess/SongName/short.wav</code>
      </p>
      <button className="admin-button primary" style={{ marginTop: 8 }} onClick={onGoToAssets}>
        Zu Assets (Audio-Guess) →
      </button>
    </div>
  );
}
