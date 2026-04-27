# Spec: Video Caching & Preview Mechanik

## Goal
Einheitlicher, cache-basierter Pfad für alle Video-Previews (In-Game, Marker-Editor, DAM-Detail-Modal). Kein Live-Transcoding während des Gameshow-Spiels, deterministisches Audio in jeder Preview, automatisches Warmup + Aufräumen, und CPU-Schonung für Hintergrundprozesse.

## Acceptance criteria

### Preview & Audio
- [ ] In-Game-Player verwendet die Cache-Routen `/videos-sdr/` (HDR+Segment) bzw. `/videos-compressed/` (SDR+Segment) mit `?strict=1`; ohne Zeit-Marker spielt er die Originaldatei direkt ab. Editor-Marker-Preview und DAM-Video-Detail-Modal spielen immer die Originaldatei (volle Seekbarkeit). Logik ist in den jeweiligen Komponenten inline implementiert ([VideoGuess.tsx](../src/components/games/VideoGuess.tsx), [VideoGuessForm.tsx](../src/components/backend/questions/VideoGuessForm.tsx), [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx))
- [ ] In jeder Preview ist genau die gewählte Audio-Spur hörbar (keine stummen Previews)
- [ ] Sprachumschalter wechselt die `src` auf die zugehörige Cache-Variante; `currentTime` bleibt erhalten
- [ ] Unter dem Marker-Editor-Player erscheint der Hinweis „Nur die gewählte Sprache ist in der Preview hörbar"
- [ ] Der synchronisierte separate Audio-Stream (verstecktes zweites `<video>` + `/videos-audio/`) existiert nicht mehr

### Cache-Generierung
- [ ] Der Cache-Button im Editor zeigt binnen ≤100 ms nach Klick sichtbares Feedback („Vorbereiten…" Spinner + disabled) — auch wenn das erste SSE-Event verzögert eintrifft
- [ ] 120 s nach der letzten Marker-/Track-/Video-Änderung einer Frage startet die Cache-Generierung automatisch (wenn nicht bereits `done`)
- [ ] Während der Auto-Warmup-Wartezeit zeigt die UI unter dem Cache-Button einen Hinweis („In 2 min wird automatisch generiert")
- [ ] Fragen in der `archive`-Instanz eines Multi-Instance-Games sind von der Cache-Generierung ausgenommen: kein Auto-Warmup-Timer, kein „Cache erstellen"-Button, kein 2-Min-Hinweis. Archivfragen werden ohnehin nie gespielt (`gameOrder` + `loadGameConfig()` lehnen sie ab), also würde jedes Encoding CPU und Platte verschwenden.
- [ ] Sobald der Cache einer Frage generiert ist, erscheint neben dem „✅ Cache für Gameshow"-Button ein Auge-Icon. Ein Klick öffnet ein Preview-Modal, das die Cache-Datei (aus `/videos-compressed/` bzw. `/videos-sdr/`) abspielt und automatisch an der Frage-Marke (`videoQuestionEnd`) stoppt — erneutes Play spielt den Antwort-Teil bis `videoAnswerEnd` weiter.
- [ ] Cache-Zustand und laufende Generierung sind pro Frage nicht am Listen-Index, sondern am stabilen Cache-Key (Video + Marker + Track) gebunden. Wird eine Frage in eine andere Instanz verschoben oder gelöscht, während ihr Cache gerade generiert wird, wird der laufende `fetch`/SSE-Stream via `AbortController` abgebrochen — ohne diesen Abbruch würden die SSE-Events auf die Frage landen, die beim Zurückrutschen auf den freigegebenen Index tritt, und dort fälschlich „Cache wird erstellt…" anzeigen.

### Cross-Trigger-Koordination
- [x] `VideoGuessForm` abonniert den `system-status`-WebSocket-Kanal und korreliert über `BackgroundTask.meta` (`{ video, start, end, track, kind }`) laufende/queued Cache-Tasks zu Fragen. Ist eine Frage gerade Gegenstand einer fremden Generierung (Warm-All, Auto-Warmup, anderer Operator), zeigt der Button stattdessen den Fortschritt („In Warteschlange" bei queued, „Cache wird erstellt…" mit Prozent bei running) und ist nicht mehr klickbar.
- [x] Der 2-Min-Auto-Warmup-Timer einer Frage fällt aus, wenn der Server bereits einen queued/running-Task mit passendem `meta` hat — damit feuert Auto-Warmup nicht redundant auf Caches, die gerade durch Warm-All erzeugt werden.
- [x] Server-seitig legt `handleSegmentWarmup` den `BackgroundTask` via `bgTaskQueue` mit Status `queued` an; Übergang nach `running` erfolgt über `bgEncodeAcquireForTask`, sobald ein Slot in der Shared-Encode-Queue frei wird. Piggy-Backer auf bereits laufende Encodes (Dedup) schalten sofort auf `running`.

### Batch-Warmup Queue-Sichtbarkeit
- [x] `POST /api/backend/cache-warm-all` legt für jede fehlende Cache-Datei sofort einen queued `BackgroundTask` an und feuert alle Encodes parallel ab (inner-parallel, outer-sequential). Die äußere SSE-Schleife wartet sequenziell auf jeden Promise und erhält so den `{ index, total, current }`-Kontrakt des Banners — während die inneren Encodes bereits durch `BG_ENCODE_CONCURRENCY=2` geregelt im Hintergrund laufen. Alle Einträge erscheinen damit zeitgleich im System-Tab als queued/running und werden sichtbar abgearbeitet.

### Cache-only im Spiel
- [ ] `/videos-compressed/` und `/videos-sdr/` akzeptieren `?strict=1` und antworten bei fehlendem Cache mit `404` + Header `X-Cache-Status: missing`, ohne ffmpeg zu spawnen
- [ ] Der In-Game-`<source>` hängt `?strict=1` an — während des Spiels wird nie live transkodiert
- [ ] Editor/DAM/Warmup rufen die Endpunkte ohne `strict` auf — dort bleibt die bisherige On-Demand-Cache-Befüllung erhalten

### Warmup-Endpunkte & Dedup
- [ ] Neuer SSE-Endpunkt `POST /api/backend/assets/videos/warmup-compressed` mit `{ percent }`-Progress (analog zu `warmup-sdr`)
- [ ] Laufende Encodes werden per `cacheFile` dedupliziert — gleichzeitige Anfragen für denselben Cache spawnen nur einen ffmpeg-Prozess; Folge-Anfragen attachen ihren `onProgress`-Callback an die bestehende Promise
- [ ] Stale `.tmp`-Dateien aus abgebrochenen Vorläufer-Encodes werden vor dem neuen Lauf gelöscht, damit ffmpeg nicht auf Reste schreibt
- Idle-Cancel verworfen: Node/Express triggert `req.on('close')` auch während aktiver SSE-Streams; ein 10-s-Timer hätte laufende Encodes unvermittelt SIGTERM-t und als „ffmpeg exit 255" bei ~90 % sichtbar gemacht. Sollte ein Client wegnavigieren, läuft der Encode zu Ende und füllt den Cache für das nächste Mal.

### Pre-flight
- [ ] Neuer Endpunkt `GET /api/backend/cache-status?gameshow={key}` liefert `{ total, ready, missing: [{ game, questionIndex, path, type, start, end, track }] }`
- [ ] `cache-status` und `cache-warm-all` akzeptieren `?allLanguages=1`: statt nur den konfigurierten `audioTrack` der Frage zu betrachten, wird das Video probed und pro eindeutiger Sprache (fällt zurück auf Track-Index ohne `language`-Tag) ein Cache-Eintrag erzeugt
- [ ] Neuer SSE-Endpunkt `POST /api/backend/cache-warm-all` arbeitet die `missing`-Liste über die gemeinsame Queue ab und sendet Gesamtfortschritt
- [ ] `HomeScreen` zeigt bei `missing.length > 0` ein Warn-Banner mit Zähler, Linkliste zu den Spielen und einem „Jetzt alle generieren"-Button
- [ ] Der „Alle generieren"-Button öffnet ein Panel mit laufendem Fortschritt; nach Abschluss verschwindet das Banner
- [x] Ein Page-Reload bricht laufende Warm-All-Encodes **nicht** ab: `cache-warm-all` entfernt den `req.on('close')`-Hook (analog zu `handleSegmentWarmup`); der SSE-Stream ist nur Beobachter, die eigentlichen Encodes laufen in `bgTaskQueue` / `runSegmentEncode` weiter. Der Banner abonniert `system-status` und zeigt nach dem Reload den Fortschritt aus den noch queued/running `sdr-warmup` / `compressed-warmup`-Tasks an.
- [x] Neuer Endpunkt `POST /api/backend/cache-warm-all/cancel` aborted den aktiven Warm-All-Run (speichert den `AbortController` modulweit in `activeCacheWarmAllAbort`). Der „Abbrechen"-Button des Banners ruft diesen Endpunkt auf, statt nur den Client-Fetch zu schließen.
- [ ] Der Start-Button bleibt klickbar (Warnung ist nicht blockierend)
- [ ] Im System-Tab zeigt der Button „Fehlende Segment-Caches generieren" die Anzahl der fehlenden Caches in Klammern an (live über `fetchCacheStatus`). Rechts daneben steht ein Toggle „Alle Sprachen", der die Anzahl und die nachfolgende Generierung auf eine Cache-Datei pro verfügbarer Sprache pro Frage umstellt.

### Cleanup
- [ ] Neue Funktion `pruneUnusedCaches()` löscht Cache-Dateien in `compressed/`, `sdr/`, deren Slug/Zeitbereich/Track nicht mehr in irgendeinem `games/*.json` referenziert wird
- [ ] Läuft beim Serverstart (verzögert ~30 s) und direkt nach jedem Game-File-Save
- [ ] In-Memory-Ready-Sets werden synchron gesäubert
- [ ] Log-Line `[cache] Pruned N stale files (compressed=y, sdr=z)` pro Lauf
- [ ] `expectedCacheFilenames()` überspringt die `archive`-Instanz — Caches von Archivfragen gelten als nicht-erwartet und werden vom nächsten Prune-Lauf entfernt. Wird eine Frage aus dem Archiv zurück in eine Spielinstanz verschoben, regeneriert sich der Cache per Auto-Warmup oder manuellem Button.
- [ ] `expectedCacheFilenames()` schließt gesperrte Instanzen (`locked === true`) aktiv ein — ihre Caches bleiben auch nach Game-File-Saves erhalten. Siehe [video-guess-lock.md](video-guess-lock.md).

### CPU-Schonung
- [ ] Gemeinsame Queue `backgroundEncodeQueue` mit Max. 2 parallelen ffmpeg-Prozessen für alle Cache-Typen (compressed + sdr + warmup)
- [ ] Alle Hintergrund-ffmpeg-Spawns werden mit `nice -n 10` gestartet (Helfer `spawnBackgroundFfmpeg()` in `server/index.ts`)
- [ ] Alle Hintergrund-ffmpeg-Aufrufe erhalten `-threads 2`
- [ ] Upload und Cache-Generierung teilen sich die Queue, sodass ein laufender Upload keine zusätzlichen ffmpegs blockt

### Tote Pfade
- [ ] Ganzdatei-Transcode-Pfad mit `toneMap: true` (HDR→SDR `-sdr.mp4`-Variante) ist entfernt: kein DAM-Button, kein Server-Zweig, kein TranscodeContext-Verbrauch
- [ ] Wenn der Ganzdatei-AAC-Transcode nach Umstellung keinen Aufrufer mehr hat, wird `startTranscodeJob`, `TranscodeContext`, `POST /api/backend/assets/videos/transcode` und der WebSocket-Kanal `transcode-status` entfernt
- [ ] Wenn `/videos-audio/:track/*` nach Umstellung keinen Aufrufer mehr hat, wird der Endpoint entfernt
- [ ] `/videos-track/:track/*` (Ganzdatei-Remux pro Audio-Spur) ist entfernt: jede Video-Guess-Frage verwendet Zeit-Marker, die Spur wird vom Segment-Encoder ins Cache-File gebacken. Whole-Film-Playback mit Nicht-Standard-Audiospur wird nicht unterstützt.
- [ ] `/videos-live/:start/:end/*` bleibt erhalten (wird aktiv für DAM-Previews großer Dateien benutzt)

## State / data changes

**Server (`server/index.ts`)**
- Neue Funktionen: `pruneUnusedCaches()`, `spawnBackgroundFfmpeg()`, `runSegmentEncode()`, `backgroundEncodeQueue` (max 2)
- Neue Endpunkte: `POST /api/backend/assets/videos/warmup-compressed`, `GET /api/backend/cache-status`, `POST /api/backend/cache-warm-all`
- Erweiterte Endpunkte: `/videos-compressed/` und `/videos-sdr/` unterstützen `?strict=1`
- Entfernt (sofern ungenutzt nach Umstellung): `POST /api/backend/assets/videos/transcode`, `GET /api/backend/assets/videos/transcode-status`, `/videos-audio/:track/*`

**Server (`server/video-probe.ts`)**
- `startTranscodeJob` wird entfernt, sofern nach Umstellung kein Aufrufer übrig ist

**Frontend**
- `src/services/backendApi.ts` — Funktionen `warmupCompressed()`, `fetchCacheStatus()`, `warmAllCaches()`
- `VideoGuess.tsx`: baut die Cache-URL (`/videos-sdr/` vs `/videos-compressed/` vs Original) inline auf und fügt `?strict=1` an die `<source>`-URL der Cache-Routen an
- `VideoGuessForm.tsx`: Audio-Sync-Block entfernt; Preview konstruiert die Cache-URL inline (ohne `strict=1`, damit ein Cache-Miss automatisch Warmup triggert); `cacheState` erweitert um `preparing: boolean`; Debounce-Timer pro Frage für 2-Min-Auto-Warmup
- `AssetsTab.tsx`: `isLiveTranscode`/`liveSeekTime`-Effekt entfernt; Preview konstruiert die Cache-URL inline; Transcode-Buttons entfernt
- `HomeScreen.tsx`: neuer Pre-flight-Check + Banner + Warm-All-Panel
- Entfernt: `TranscodeContext.tsx` (sofern Ganzdatei-Transcode entfällt)

## UI behaviour

**Pre-flight Banner auf HomeScreen**
- Position: oben, direkt unter Header
- Farbe: gelb/warn (`rgba(251,191,36,...)` — konsistent mit existierenden Warnungen)
- Inhalt: „⚠️ N Video-Caches fehlen." + klickbare Liste der betroffenen Fragen (Spielname · Fragenummer) + Button „Jetzt alle generieren (N)"
- Panel (beim Klick auf Button): Fortschrittsbalken + aktuell laufende Datei + Abbrechen-Button

**Sprachumschalter-Hinweis (Marker-Editor)**
- Unter dem Player, klein, in `rgba(255,255,255,0.5)`: „Nur die gewählte Sprache ist in der Preview hörbar"

**Cache-Button Sofort-Feedback**
- Vor dem ersten SSE-Event: Button disabled, Spinner, Text „Vorbereiten…"
- Ab erstem Event: bestehender Progressbar mit Prozentanzeige
- Nach Abschluss: bestehender „✅ Cache für Gameshow"-Zustand

**2-Min-Auto-Warmup-Hinweis**
- Unter dem Cache-Button, klein, in `rgba(255,255,255,0.45)`: „Wird in 2 Min. automatisch erzeugt"
- Verschwindet, sobald Generierung läuft oder fertig ist

## Out of scope
- Wiederaufnehmbares Warmup (abgebrochener ffmpeg startet beim nächsten Mal wieder bei 0)
- GPU-beschleunigtes Transcoding
- Vorverschlüsselte (DRM) Cache-Varianten
- Automatischer Cache-Rebuild, wenn eine Quelldatei modifiziert wurde (aktuell nur Slug-basierte Prune)
- Konfigurierbare Warmup-Verzögerung (fix 120 s)
