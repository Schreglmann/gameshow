/**
 * Lightweight global signal for tracking whether bandwidth-sensitive
 * activities (e.g. video playback) are in progress.
 *
 * When active, chunked uploads throttle themselves to leave headroom.
 * Also notifies the server so NAS background sync can be throttled too.
 */

let activeStreams = 0;

function notifyServer(active: boolean) {
  fetch('/api/backend/stream-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  }).catch(() => {});
}

export function notifyStreamStart() {
  activeStreams++;
  notifyServer(true);
}

export function notifyStreamEnd() {
  activeStreams = Math.max(0, activeStreams - 1);
  notifyServer(false);
}

export function isStreamActive() { return activeStreams > 0; }
