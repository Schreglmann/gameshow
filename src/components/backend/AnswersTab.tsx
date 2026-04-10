import { useGamemasterAnswer } from '@/hooks/useGamemasterSync';
import '@/styles/gamemaster.css';

export default function AnswersTab() {
  const data = useGamemasterAnswer();

  return (
    <div className="answers-tab">
      <div className="answers-tab-header">
        <a
          href="/gamemaster"
          target="_blank"
          rel="noopener noreferrer"
          className="answers-tab-fullscreen"
        >
          Vollbild öffnen
        </a>
      </div>
      <div className="backend-card answers-tab-card">
        {data ? (
          <>
            <div className="gamemaster-meta">
              {data.questionNumber === 0 ? 'Beispiel' : `Frage ${data.questionNumber} / ${data.totalQuestions}`}
            </div>
            <div className="gamemaster-title">{data.gameTitle}</div>
            <div className="gamemaster-answer">{data.answer}</div>
            {data.answerImage && (
              <img
                className="gamemaster-image"
                src={data.answerImage}
                alt="Antwort"
              />
            )}
            {data.extraInfo && (
              <div className="gamemaster-extra">
                {data.extraInfo.split('\n').map((line, i) => (
                  <div key={i} className={line.includes(data.answer) ? 'gamemaster-extra-highlight' : undefined}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="answers-tab-empty">
            <div className="answers-tab-empty-icon">📝</div>
            <div className="answers-tab-empty-title">Antworten</div>
            <div className="answers-tab-empty-description">
              Hier wird während einer laufenden Gameshow die aktuelle Antwort angezeigt.
              Starte ein Spiel in einem anderen Tab — die Lösung erscheint dann automatisch hier.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
