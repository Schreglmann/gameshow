# Spec: City compass (Städte-Kompass)

## Goal
A hidden city sits at the center of a compass rose and the named cities around it are placed at their true geographic bearing, so teams identify the center city from the constellation of its neighbors.

## Acceptance criteria
- [x] Questions are defined in the game JSON with `center` (a city), `neighbors` (3–8 cities), and optional `question`, `info`, `answerImage`, `disabled`
- [x] A city is `{ name, lat, lon, country? }` — coordinates are stored in the game JSON, not looked up at runtime, so the show renders offline and the city dataset never reaches the show bundle
- [x] Each neighbor is drawn on the compass ring at its **initial great-circle bearing** from the center, with north at the top; a spoke from the center to the dot makes the angle readable
- [x] Bearing uses the great-circle formula, not the difference of latitude and longitude — at 2000 km the naive version is off by several degrees
- [x] Distance is **not** encoded in the radius. Every neighbor sits on the same ring; the distance is written into the label (`Linz · 180 km`)
- [x] `showDistances` (instance level) appends the km to every label. **Off by default**: the bearing alone is the intended puzzle, and the distance is an opt-in that makes it easier
- [x] `reveal` (instance level, default `'all'`) is either `'all'` (the whole constellation is visible at once) or `'progressive'` (2 neighbors at first, one more per host advance, then the answer). One neighbor alone gives only a direction, which is why progressive starts at 2
- [x] Neighbor order in the JSON is the reveal order; the admin form reorders by drag
- [x] Labels never overlap: neighbors closer than 14° in bearing get their label radius staggered outward, and `text-anchor` follows the quadrant
- [x] The SVG is cropped to what it drew: `layoutCompass` reports the bounding box of ring, dots and labels, and that box is the viewBox. A fixed box has to be wide enough for the longest name a question could carry, which drew the ring small inside empty margins on every question without one
- [x] The rose is sized by width alone — the height it may take (`62vh`, at most 780 px) times the crop's ratio. Constraining the height instead leaves the SVG letterboxing itself inside a box that is still the full width. The height needs the cap because a question of short names crops to a nearly square box, which at full width would push the answer off the screen
- [x] Nothing is drawn through the middle: spokes and the crosshair arms start outside the center marker, and outside the solution pill once the city is revealed. A translucent pill with every spoke converging visibly through the name was the reason the reveal read badly
- [x] A name too long for the pill is set smaller rather than widening it. `Klagenfurt am Wörthersee · AT` at the full size would be wider than the ring is across and would cover the dots it sits between
- [x] Revealing the question draws the constellation: per city its spoke draws outward from the center, then the dot lands, then the name fades in, staggered 45 ms apart. Finished within a second even at eight cities (7 × 45 + 380 + 260 = 955 ms), and skipped entirely under `prefers-reduced-motion`
- [x] Every keyframe animates *from* a hidden state to the element's normal styling, so a rose whose animations do not run is simply there, fully drawn
- [x] A progressive reveal animates in the city it just added and leaves the rest standing: the element keys are per city and per center, so React remounts the whole drawing on a new question and nothing else
- [x] Host advance reveals the answer: the center marker changes from `?` to the city name (with country when set), plus the optional `answerImage`
- [x] Back navigation mirrors `ImageGuess`: answer shown → hide it; otherwise the previous question with its answer shown
- [x] Play index 0 is the `Beispiel` question (pinned, never shuffled); the counter reads `Stadt N von M` for the rest
- [x] Honors the shared `randomizeQuestions` + `questionLimit` via `useQuestionOrder`; `disabled` questions are filtered
- [x] Swapping a city in the admin redraws the rose on the running show without a reload and without moving the host to a different question
- [x] After the last question and its answer, calls `onGameComplete()`
- [x] Points awarded by the host via `AwardPoints`, value = `currentIndex + 1`
- [x] Gamemaster screen shows the center city as the answer **and**, below it, the neighbor list with a `revealed` flag per entry. The neighbors travel on `hintList`, not `answerList`: the GM card renders `answerList` *instead of* the plain answer (it is the answer for `ranking`), which left the host looking at the clues the players already see and no solution while asking. `hintList` is rendered as its own labelled "Hinweise" block, with static rows — no game listens for a hint-jump command
- [x] Under "Antworten verstecken" the revealed hints stay legible (they are on the projector anyway) and only the pending ones are masked, while the center city is hidden like any other answer
- [x] The rose has no background of its own: it inherits the card text color and paints every part with `currentColor` at its own opacity, so it reads on every theme, light or dark. The solved center reuses the answer colour of `.quiz-answer` — which every theme already picks to contrast with its card — as a bright outline, a soft halo and the name itself
- [x] Validator requires `center` and at least 3 `neighbors`, each with a name and coordinates in range, and `reveal` / `showDistances` only on this game type
- [x] A neighbor beyond 2000 km is flagged in the admin editor (the row's distance turns red and reads "über 2000 km") rather than by the validator, which has no warning channel per question. Such a question still plays

### Auto neighbor selection (admin)
- [x] The admin form has an **Auto** button that replaces the neighbor list with a generated selection, plus a re-roll button and a difficulty select
- [x] Selection runs in the client against the bundled dataset — no endpoint, so it also works at an offline event
- [x] Candidates are restricted to 60–2000 km from the center. Below 60 km a city is a suburb of the answer; beyond 2000 km it is outside the intended range
- [x] Prominence gates distance, which is what keeps the puzzle solvable with general knowledge: capitals and cities above 300,000 inhabitants are eligible at any distance, cities above 150,000 up to 1200 km, and small towns only up to 350 km. Around Austria and Germany the small-town tier is dense enough that Wels, Steyr, Kufstein, and Zell am See can appear
- [x] One slot is reserved for a `local`-tier city, on every difficulty except `hard`. Without it that tier is dead weight: a capital scores its population plus the largest tier bonus, so a small town never wins a slot on score alone and every generated question comes out as six capitals
- [x] The regional slot has its own scoring — one order of magnitude of population traded against 150 km — because population alone always picks a distant larger town (and GeoNames understates Austrian towns, so a German one of the same real size wins even for an Austrian center), while distance alone picks unrecognizable commuter suburbs
- [x] Two selected neighbors are at least 25° apart in bearing, so labels do not collide and no hint duplicates another
- [x] The selection contains at least one city within 300 km and one beyond 800 km when the dataset offers them, so a question is neither unsolvable nor trivial
- [x] Population is a weak term in the score, and the jitter is wide. `log10(population)` spans 3 to 7.3, so at full weight it alone decided the ranking: Moskau, Rom and Ankara took every slot they were eligible for and each re-roll produced almost the same question. Prominence now comes mostly from the tier, and cities that are comparably well known reorder freely — around 37 different cities appear across 20 seeds per center
- [x] Arrow keys move the highlight in the city search and Enter takes it (or the only match, so a unique name needs no arrow key); Escape closes. Same handling as the players and game comboboxes in `GameshowEditor.tsx`, including ArrowUp from no highlight landing on the first entry
- [x] Neighbors are returned sorted by descending distance, which makes the progressive reveal move from the vague far city to the telling near one
- [x] The same seed produces the same selection; re-roll changes the seed

## State / data changes
- No `AppState` changes and no new API route — questions come from the game JSON and the Auto button computes in the browser
- New types in `src/types/config.ts`: `CompassCity`, `CityCompassQuestion`, `CityCompassConfig`; `'city-compass'` joins the `GameType` union and `CityCompassConfig` the `GameConfig` union

```ts
export interface CompassCity {
  name: string;
  lat: number;
  lon: number;
  country?: string;
}

export interface CityCompassQuestion {
  center: CompassCity;
  neighbors: CompassCity[];
  question?: string;      // default "Welche Stadt liegt im Zentrum?"
  info?: string;          // subtitle above the question — must not name the answer
  answerImage?: string;
  disabled?: boolean;
}

export interface CityCompassConfig extends BaseGameConfig {
  type: 'city-compass';
  questions: CityCompassQuestion[];
  showDistances?: boolean;   // default false
  reveal?: 'all' | 'progressive';   // default 'all'
}
```

- `GamemasterAnswerData.hintList` carries the neighbor list — same item shape as `answerList` (`{ rank, text, revealed }`), but additive to `answer` instead of replacing it. Documented on the `gamemaster-answer` channel in [../api/asyncapi.yaml](../api/asyncapi.yaml)

## City dataset
The repository has no coordinate data, so the dataset is generated and committed.

`scripts/generate-city-dataset.ts` reads the `all-the-cities` devDependency (135,233 cities above 1000 inhabitants, derived from GeoNames) and writes `src/data/cities.generated.ts`. The 6.4 MB source is far too large and too noisy for a picker aimed at well-known cities, so the generator keeps a tier per city and filters by country and population:

| Tier | Rule |
|------|------|
| `capital` | `featureCode === 'PPLC'` above 2000 inhabitants, plus a forced list for the ones below it (Vatikanstadt) |
| `metro` | population ≥ 300,000, worldwide |
| `major` | Europe ≥ 150,000; neighboring countries (IT, CZ, SK, HU, SI, HR, PL, FR, NL, BE, DK, LU) ≥ 60,000; plus a forced list for cities GeoNames counts only by their historic core (Venedig at 51,298, Meran, Karlsbad, Innsbruck) |
| `local` | DE ≥ 25,000; AT, CH, LI ≥ 6,000 — the floor that still includes Zell am See (7619) and Zermatt (6629); AT additionally down to 2,000 when the entry is an administrative seat — plus a forced list of well-known small towns below it |

Austria gets the extra step down because its GeoNames figures are the Ortschaft rather than the Gemeinde, and the gap widens as the town gets smaller: Hallein is listed at 7208 against a real 21,000, Seekirchen am Wallersee at 3579 against 11,300. A flat 6,000 therefore cut away exactly the band the game wants most — the small towns that pin a region down at once. The extra step is restricted to administrative seats (`PPLA`…`PPLA5`, `PPLC`), which in Austria is what separates a Gemeinde from a hamlet; below 6,000 the plain `PPL` entries are mostly the latter (`Taxach`, `Neualm`, `Burgfried`, `Glasenbach`).

3138 cities survive. City districts (`PPLX`) are excluded, or `Favoriten` would sit next to `Wien` and `Wandsbek` next to `Hamburg`.

GeoNames names a city either in English or in its own language, with no rule saying which (`Munich`, but `Antwerpen`; `Prague`, but `Sevilla`), so a hand-written `GERMAN_NAMES` map renames the ones that differ from German. Every key of every override table is checked against the source data and the run fails on one that matches nothing: GeoNames renames cities — it now calls Odesa `Odessa` — and a stale key would leave the English name on stage with no other symptom.

The output is one line per city inside a single template literal rather than an array of object literals: about 105 KB instead of 400 KB, one diff line per city, and `tsc` only sees a string. Only the admin bundle imports it, through `await import()`.

The data is GeoNames under CC BY 4.0. The attribution belongs in the generated file's header and in `README.md`.

## Pure logic
`src/utils/cityCompass.ts`, used by both the show and the admin form:

- `haversineKm(a, b)` — distance in km
- `initialBearingDeg(from, to)` — 0–360°, 0 = north
- `formatDistanceKm(km)` — `"120 km"`, rounded to 5 km below 100 km and to 10 km above
- `layoutCompass(center, neighbors, opts)` — positioned nodes for the SVG: dot, spoke (inner end clear of the middle) and label per neighbor, the crop box, the crosshair insets, and the solution pill's size and font size. `neighbors` is always the full list even when the caller draws only the first few, so a progressive reveal adds cities to a rose that stays exactly where it is
- `formatDistanceKm`, `LABEL_FONT_SIZE`, `DISTANCE_FONT_SIZE`, `UNKNOWN_FONT_SIZE`, `LABEL_LINE_HEIGHT` — the type sizes live here, not in the stylesheet, because the crop is computed from the text extents. Text cannot be measured without a DOM, so the crop estimates the advance width generously: underestimating cuts a name off, overestimating only leaves a little air
- `pickNeighbors(center, cities, opts)` — the Auto selection described above

## UI behaviour
- Component: `src/components/games/CityCompass.tsx`, wrapping `BaseGameWrapper`, modeled on `Q1.tsx` for the progressive reveal and on `ImageGuess.tsx` for the question-order handling
- The outer component calls `useQuestionOrder(...)` and passes `order` to both the wrapper and the inner component; the inner one uses `useLiveQuestionIndex(order, resumeAtEnd)`. Per-question effects key on `qKey`, the gamemaster payload on `qIdx`. Without this, editing the game's questions mid-show re-deals the deck — see [live-question-order.md](../live-question-order.md)
- `src/components/common/CompassRose.tsx` renders the SVG: ring, faint cardinal cross hairs with north up, one spoke and dot per neighbor, label beside the dot, `?` or the solution in the center. No compass letters — the cross hairs carry the axes. The viewBox is the crop `layoutCompass` measured, and the ratio of that crop goes to the stylesheet inline as `--compass-aspect`. It is a pure function of the question, which is what makes an admin edit appear on the show as soon as the new config arrives. It lives under `common/` rather than inside the game component (where `ColorPie` sits) so importing it into the admin form does not pull `BaseGameWrapper` into the admin bundle
- `CompassRose` is used by the show, by the admin form as a live preview, and by `ThemeShowcase` — twice there, hidden and solved, because the solved pill is the one place the rose carries a second colour
- Label text uses SVG user-space units so it scales with the rose, and needs no breakpoints: a label keeps its share of the rose at every width. Cropping the box already makes the names on a phone roughly twice the size the fixed box gave them
- Styles: `.city-compass-*` in `src/styles/game.css`. `overflow: visible` on the SVG is a guard — a name a few units wider than the crop estimated should spill rather than lose a letter. The admin preview overrides the height cap to 420 px, since it sits in a form column where a preview as tall as the column is wide would push the fields off the screen
- Auto-scroll follows the other quiz games via `useQuizAutoScroll(qKey, ...)`
- Admin form: `src/components/backend/questions/CityCompassForm.tsx`. Per question a city search for the center, the same search to add neighbors, the neighbor list with distance and bearing per entry, reorder buttons, the Auto controls, and the live `CompassRose` preview. A city the dataset does not have can be given its own coordinates
- The two instance-level controls sit at the top of that form, in the admin's own `be-toggle` markup so they match "Fragen zufällig anordnen" and "Punktevergabe": a switch for `showDistances` and a select for `reveal`. `InstanceEditor.tsx` passes them in and stores `undefined` for either default, so the JSON stays clean

## Rules phrasing
`reveal: 'all'` matches Archetype A. `reveal: 'progressive'` is a new mechanic and gets its own Archetype X entry in [rules-standard.md](../rules-standard.md).

## Out of scope
- Encoding distance in the radius (an azimuthal-equidistant projection) — the ring is deliberately uniform
- A separate phone layout. Below roughly 600 px the labels are small, and that is a density limit rather than a sizing bug: six two-line names will not fit legibly around a ring that narrow. Enlarging the type would need the crop to know the viewport, which means a resize observer in the layout — real complexity for a surface that is not the stage. The show is a projector surface, and the phone surface is the gamemaster PWA
- Wrapping a long city name over two lines. It would narrow the crop, which helps the phone, but it also makes the box taller — and on the stage the height is what the rose runs out of first, so the ring would come out smaller where it matters most
- Any map background, coastline, or border; the rose is the whole picture
- Teams entering guesses on their own devices
- Looking a city up by coordinates at runtime, or letting the server enrich the questions
