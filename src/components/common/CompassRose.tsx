import { useMemo } from 'react';
import type { CompassCity } from '@/types/config';
import {
  formatDistanceKm,
  layoutCompass,
  DISTANCE_FONT_SIZE,
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  UNKNOWN_FONT_SIZE,
} from '@/utils/cityCompass';

/**
 * The compass rose of the `city-compass` game type: the hidden center city, and the
 * named cities around it placed at their true bearing from it. North is up. Distance
 * is written into the label rather than into the radius, so all neighbors sit on one
 * ring — the angles carry the puzzle.
 *
 * A pure function of its props, which is what makes an admin edit show up on a
 * running show the moment the new config arrives, and what lets the admin preview
 * and the stage draw the exact same picture. Lives under `common/` rather than in
 * CityCompass.tsx (where the comparable `ColorPie` sits inside ColorGuess.tsx) so the
 * admin form can import it without pulling BaseGameWrapper into the admin bundle.
 *
 * Every color comes from the theme: the SVG inherits the card text color and paints
 * with `currentColor` at varying opacity, so the rose sits directly on whatever
 * background the active theme draws. The viewBox is the crop `layoutCompass` measured,
 * so the drawing fills its box instead of floating in margins sized for the longest
 * name a question might have had. See src/styles/game.css and
 * specs/games/city-compass.md.
 */

/**
 * Each city is drawn in turn — spoke out from the center, dot, then name. The
 * constellation assembling itself is what makes the reveal read as one event, and it
 * finishes inside a second even at the maximum of eight cities
 * (7 * 45 + 380 + 260 = 955 ms).
 */
const STAGGER_MS = 45;
const DOT_DELAY_MS = 260;
const LABEL_DELAY_MS = 380;

export interface CompassRoseProps {
  /** The hidden city in the middle. Only its coordinates are used until `solved`. */
  center: CompassCity;
  neighbors: readonly CompassCity[];
  /** How many neighbors to draw, counted from the start. Defaults to all of them. */
  revealedCount?: number;
  /** Append the distance to each neighbor's name. Off by default, matching the
   *  game config. */
  showDistances?: boolean;
  /** Replace the `?` in the middle with the center city's name. */
  solved?: boolean;
  /** Merged onto the root SVG, so a caller can override the default sizing. */
  className?: string;
}

export default function CompassRose({
  center,
  neighbors,
  revealedCount,
  showDistances = false,
  solved = false,
  className,
}: CompassRoseProps) {
  const centerLabel = useMemo(
    () => [center.name, center.country].filter(Boolean).join(' · '),
    [center.name, center.country],
  );

  const { cx, cy, ringRadius, centerRadius, nodes, viewBox, pill, grid } = useMemo(
    () => layoutCompass(center, neighbors, {
      showDistances,
      solutionLabel: solved ? centerLabel : undefined,
    }),
    [center, neighbors, showDistances, solved, centerLabel],
  );

  const visible = nodes.slice(0, revealedCount ?? nodes.length);
  /** Tenths of a user unit are as fine as the crop estimate is meaningful. */
  const box = useMemo(() => ({
    x: Math.round(viewBox.x * 10) / 10,
    y: Math.round(viewBox.y * 10) / 10,
    width: Math.round(viewBox.width * 10) / 10,
    height: Math.round(viewBox.height * 10) / 10,
  }), [viewBox]);

  /**
   * Changing the center city changes every key below, so React remounts the drawing
   * and the CSS animations run again — one question's constellation never sits still
   * while the next one is on screen. Within a question the keys are stable, so a
   * progressive reveal animates in the city it just added and leaves the rest alone.
   */
  const roseKey = `${center.name}|${center.lat},${center.lon}`;

  const description = visible.length > 0
    ? `Kompass mit ${visible.length} Städten rund um eine unbekannte Stadt: ${visible.map(n => n.city.name).join(', ')}`
    : 'Kompass ohne Städte';

  return (
    <svg
      className={`compass-rose${className ? ` ${className}` : ''}`}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      // The stylesheet needs the crop's ratio as a number: it sizes the rose by width
      // alone, derived from the height it may take, so the box always fits the drawing
      // exactly. Constraining the height directly leaves the SVG letterboxing itself
      // inside a box that is still full width.
      style={{ '--compass-aspect': box.width / box.height } as React.CSSProperties}
      role="img"
      aria-label={description}
    >
      {/* Cross hairs mark the cardinal axes — north is up. No inner rings: distance
          is not encoded in the radius, and a ring would suggest it is. Each axis is
          two arms, so nothing crosses the center. */}
      <g className="compass-rose__grid" key={`${roseKey}-grid`}>
        <line x1={cx - ringRadius} y1={cy} x2={cx - grid.horizontal} y2={cy} />
        <line x1={cx + grid.horizontal} y1={cy} x2={cx + ringRadius} y2={cy} />
        <line x1={cx} y1={cy - ringRadius} x2={cx} y2={cy - grid.vertical} />
        <line x1={cx} y1={cy + grid.vertical} x2={cx} y2={cy + ringRadius} />
      </g>
      <circle className="compass-rose__ring" key={`${roseKey}-ring`} cx={cx} cy={cy} r={ringRadius} />

      {visible.map((node, i) => (
        <line
          key={`${roseKey}-spoke-${node.city.name}`}
          className="compass-rose__spoke"
          x1={node.spokeX}
          y1={node.spokeY}
          x2={node.x}
          y2={node.y}
          style={{
            '--compass-spoke-len': node.spokeLength.toFixed(1),
            animationDelay: `${i * STAGGER_MS}ms`,
          } as React.CSSProperties}
        />
      ))}

      {visible.map((node, i) => (
        <circle
          key={`${roseKey}-dot-${node.city.name}`}
          className="compass-rose__dot"
          cx={node.x}
          cy={node.y}
          r={13}
          style={{ animationDelay: `${i * STAGGER_MS + DOT_DELAY_MS}ms` }}
        />
      ))}

      {visible.map((node, i) => (
        <text
          key={`${roseKey}-label-${node.city.name}`}
          className="compass-rose__label"
          x={node.labelX}
          y={node.labelY}
          textAnchor={node.anchor}
          fontSize={LABEL_FONT_SIZE}
          style={{ animationDelay: `${i * STAGGER_MS + LABEL_DELAY_MS}ms` }}
        >
          {node.city.name}
          {showDistances && (
            <tspan
              className="compass-rose__distance"
              x={node.labelX}
              dy={LABEL_LINE_HEIGHT}
              fontSize={DISTANCE_FONT_SIZE}
            >
              {formatDistanceKm(node.distanceKm)}
            </tspan>
          )}
        </text>
      ))}

      {pill ? (
        <g className="compass-rose__solved" key={`${roseKey}-solved`}>
          <rect
            className="compass-rose__pill"
            x={cx - pill.width / 2}
            y={cy - pill.height / 2}
            width={pill.width}
            height={pill.height}
            rx={pill.height / 2}
          />
          <text
            className="compass-rose__solution"
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={pill.fontSize}
          >
            {centerLabel}
          </text>
        </g>
      ) : (
        <g className="compass-rose__hidden-center" key={`${roseKey}-hidden`}>
          <circle className="compass-rose__center" cx={cx} cy={cy} r={centerRadius} />
          <text
            className="compass-rose__unknown"
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={UNKNOWN_FONT_SIZE}
          >
            ?
          </text>
        </g>
      )}
    </svg>
  );
}
