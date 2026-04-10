import { useGamemasterAnswer } from '@/hooks/useGamemasterSync';

export default function GamemasterScreen() {
  const data = useGamemasterAnswer();

  return (
    <div className="gamemaster-screen">
      <div className="gamemaster-card">
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
          <div className="gamemaster-waiting">Warten auf nächste Frage...</div>
        )}
      </div>
    </div>
  );
}
