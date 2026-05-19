// Minimal service worker. The PWA exists only to be installable to the home
// screen; it does no caching, no offline support, no fetch interception.
//
// Why no fetch handler at all: when an SW has none, modern browsers skip
// routing fetches through the SW process entirely — so streaming responses
// (SSE, fetch ReadableStream) are never buffered or wrapped.
//
// `skipWaiting` + `clients.claim` ensure that any older proxying SW from a
// previous deploy is replaced immediately on next page load, instead of
// hanging around until every tab is closed.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
