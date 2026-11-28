/**
 * The colour stripe of the `film-stripe` game type ("Filmstreifen"): one vertical
 * line per sampled moment of a film, left to right in film order.
 *
 * A pure function of its props, so the show, the admin preview and the theme
 * showcase draw the same picture. Lives under `common/` so the admin form can
 * import it without pulling BaseGameWrapper into the admin bundle.
 *
 * Drawn as SVG rects on a viewBox one unit per colour, stretched to the box with
 * `preserveAspectRatio="none"` — sharp at any size, and no canvas to redraw on
 * resize. See src/styles/game.css and specs/games/film-stripe.md.
 */

export interface FilmStripeBarProps {
  /** One CSS colour per moment, in film order. */
  colors: readonly string[];
  /** Position of the time-lapse marker as an index into `colors`; omitted = no marker. */
  markerIndex?: number;
  /** Changing this replays the wipe-in animation (the show passes the question key). */
  animationKey?: string;
  /** Merged onto the root element, so a caller can override the default sizing. */
  className?: string;
}

export default function FilmStripeBar({ colors, markerIndex, animationKey, className }: FilmStripeBarProps) {
  const count = colors.length;
  if (count === 0) return null;
  const hasMarker = markerIndex !== undefined && markerIndex >= 0 && markerIndex < count;

  return (
    <div
      className={`film-stripe-bar${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`Farbstreifen eines Films aus ${count} Farben`}
    >
      <svg
        key={animationKey}
        className="film-stripe-bar__colors"
        viewBox={`0 0 ${count} 1`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {colors.map((color, i) => (
          // A hair wider than one unit: neighbouring rects otherwise leave a
          // sub-pixel seam where the page shows through.
          <rect key={i} x={i} y={0} width={i === count - 1 ? 1 : 1.05} height={1} fill={color} />
        ))}
      </svg>
      {hasMarker && (
        <div
          className="film-stripe-bar__marker"
          style={{ left: `${((markerIndex + 0.5) / count) * 100}%` }}
        />
      )}
    </div>
  );
}
