/**
 * Lightweight global signal for tracking whether bandwidth-sensitive
 * activities (e.g. video playback) are in progress.
 *
 * When active, chunked uploads throttle themselves to leave headroom.
 */

let activeStreams = 0;

export function notifyStreamStart() { activeStreams++; }
export function notifyStreamEnd() { activeStreams = Math.max(0, activeStreams - 1); }
export function isStreamActive() { return activeStreams > 0; }
