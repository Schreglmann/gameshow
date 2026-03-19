interface Props {
  onGoToAssets: () => void;
}

export default function ImageGameInfo({ onGoToAssets }: Props) {
  return (
    <div className="backend-card" style={{ borderColor: 'rgba(102, 126, 234, 0.3)' }}>
      <h3 style={{ marginTop: 0 }}>Fragen werden dynamisch geladen</h3>
      <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        Image-Game Fragen werden automatisch aus dem Dateisystem generiert.
        Jede Bilddatei in <code>/image-guess/</code> wird zu einer Frage.
        Der Dateiname (ohne Endung) wird als Antwort verwendet (Präfix <code>Beispiel_</code> markiert Beispielfragen).
      </p>
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
        Unterstützte Formate: .jpg, .jpeg, .png, .gif
      </p>
      <button className="admin-button primary" style={{ marginTop: 8 }} onClick={onGoToAssets}>
        Zu Assets (Image-Guess) →
      </button>
    </div>
  );
}
