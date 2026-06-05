import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchSystemStatus } from '@/services/backendApi';
import '@/styles/gamemaster.css';

interface Props {
  onClose: () => void;
}

interface IpOption {
  iface: string;
  address: string;
  url: string;
}

/** Path of the gamemaster PWA (trailing slash matches the Vite `base` scope → no redirect). */
const GM_PATH = '/gamemaster/';

/** Build the connect URL a phone scans. Omit the port only for the protocol defaults (80/443). */
function buildGmUrl(host: string, port: number | string | null, protocol: string): string {
  const portStr = port == null ? '' : String(port);
  const isDefault =
    (protocol === 'http:' && portStr === '80') ||
    (protocol === 'https:' && portStr === '443');
  const suffix = portStr && !isDefault ? `:${portStr}` : '';
  return `${protocol}//${host}${suffix}${GM_PATH}`;
}

export default function GamemasterQrModal({ onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ips, setIps] = useState<IpOption[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  // ESC closes — mirrors ConfirmModal's keydown effect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    fetchSystemStatus()
      .then(status => {
        if (!active) return;
        const { port, localIps } = status.server.network;
        const proto = window.location.protocol;
        const effectivePort = port ?? window.location.port;
        const list: IpOption[] = (localIps ?? []).map(ip => ({
          iface: ip.iface,
          address: ip.address,
          url: buildGmUrl(ip.address, effectivePort, proto),
        }));
        // Fallback: no LAN IP reported but we're not on localhost → encode the current origin.
        if (list.length === 0) {
          const host = window.location.hostname;
          if (host && host !== 'localhost' && host !== '127.0.0.1') {
            list.push({
              iface: 'aktuell',
              address: host,
              url: buildGmUrl(host, window.location.port, proto),
            });
          }
        }
        setIps(list);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Netzwerkstatus nicht verfügbar');
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const selected = ips[selectedIdx];

  const handleCopy = useCallback(() => {
    if (!selected) return;
    navigator.clipboard?.writeText(selected.url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => { /* clipboard unavailable — URL is shown for manual copy */ },
    );
  }, [selected]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="qr-modal-box"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
      >
        <button className="qr-modal-close" onClick={onClose} aria-label="Schließen">×</button>
        <h3 id="qr-modal-title" className="qr-modal-title">Gamemaster auf anderem Gerät öffnen</h3>
        <p className="qr-modal-hint">
          QR-Code mit dem Handy scannen, um die Gamemaster-Ansicht direkt zu öffnen.
          Das Gerät muss im selben WLAN sein.
        </p>

        {loading && <p className="qr-modal-status">Lade Netzwerkadresse…</p>}

        {!loading && error && (
          <p className="qr-modal-status qr-modal-error">Fehler: {error}</p>
        )}

        {!loading && !error && !selected && (
          <p className="qr-modal-status qr-modal-error">
            Keine lokale IP gefunden — Server-Netzwerkstatus prüfen.
          </p>
        )}

        {!loading && selected && (
          <>
            <div className="qr-code-frame">
              <QRCodeSVG value={selected.url} size={240} marginSize={2} />
            </div>

            {ips.length > 1 && (
              <div className="qr-ip-pills" role="group" aria-label="Netzwerk auswählen">
                {ips.map((ip, i) => (
                  <button
                    key={`${ip.iface}-${ip.address}`}
                    className={`qr-ip-pill ${i === selectedIdx ? 'is-active' : ''}`}
                    onClick={() => setSelectedIdx(i)}
                  >
                    {ip.iface} — {ip.address}
                  </button>
                ))}
              </div>
            )}

            <div className="qr-modal-url-row">
              <code className="qr-modal-url">{selected.url}</code>
              <button className="answers-tab-fullscreen qr-modal-copy" onClick={handleCopy}>
                {copied ? 'Kopiert!' : 'Kopieren'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
