import '@/styles/gamemaster.css';

export default function AnswersTab() {
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
      <iframe
        src="/gamemaster"
        className="answers-tab-iframe"
        title="Gamemaster"
      />
    </div>
  );
}
