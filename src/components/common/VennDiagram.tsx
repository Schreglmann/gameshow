import { useMemo } from 'react';
import { layoutVenn, VENN_UNKNOWN_FONT_SIZE } from '@/utils/vennLayout';

/**
 * The diagram of the `venn` game type ("Schnittmenge"): one circle per category, the
 * category name outside it, and a `?` — or, once solved, the answer — in the area all
 * visible circles share.
 *
 * A pure function of its props, like CompassRose: an admin edit shows up on a running
 * show the moment the new config arrives, and the admin preview, the theme showcase
 * and the stage draw the same picture. Lives under `common/` so the admin form can
 * import it without pulling BaseGameWrapper into the admin bundle.
 *
 * Colors come from the theme (see src/styles/game.css): the SVG inherits the card
 * text color, the circles are tinted with the primary color and the hint circle with
 * the gold one. See specs/games/venn.md.
 */

export interface VennDiagramProps {
  /** 2-3 category names, in reveal order. */
  sets: readonly string[];
  /** How many circles to draw, counted from the start. Defaults to all of them. */
  revealedCount?: number;
  /** Replace the `?` with the answer. */
  solved?: boolean;
  answer?: string;
  /** Merged onto the root SVG, so a caller can override the default sizing. */
  className?: string;
}

export default function VennDiagram({ sets, revealedCount, solved = false, answer, className }: VennDiagramProps) {
  const solution = solved ? answer?.trim() : undefined;
  const layout = useMemo(() => layoutVenn(sets, { solutionLabel: solution }), [sets, solution]);

  const visibleCount = Math.max(0, Math.min(layout.circles.length, revealedCount ?? layout.circles.length));
  const visible = layout.circles.slice(0, visibleCount);
  const focus = layout.focus[visibleCount >= 3 ? 3 : 2]!;

  /**
   * A new question changes every key below, so React remounts the drawing and the
   * CSS animations run again. Within a question the keys are stable: adding the hint
   * circle animates that circle in and leaves the other two alone.
   */
  const diagramKey = sets.join('|');

  const description = visible.length > 0
    ? `Schnittmenge aus ${visible.map(c => c.label.lines.join(' ')).join(', ')}`
    : 'Leeres Mengendiagramm';

  return (
    <svg
      className={`venn-diagram${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${layout.width} ${Math.round(layout.height)}`}
      // The stylesheet sizes the diagram by width alone, from the height it may take
      // times this ratio — see `.compass-rose` for why the height is not set directly.
      style={{ '--venn-aspect': layout.width / layout.height } as React.CSSProperties}
      role="img"
      aria-label={description}
    >
      {visible.map((circle, i) => (
        <circle
          key={`${diagramKey}-circle-${i}`}
          className={`venn-diagram__circle${i === 2 ? ' venn-diagram__circle--hint' : ''}`}
          cx={circle.cx}
          cy={circle.cy}
          r={circle.r}
          style={{ animationDelay: `${i < 2 ? i * 140 : 0}ms` }}
        />
      ))}

      {visible.map((circle, i) => (
        <text
          key={`${diagramKey}-label-${i}`}
          className={`venn-diagram__label${i === 2 ? ' venn-diagram__label--hint' : ''}`}
          textAnchor="middle"
          fontSize={circle.label.fontSize}
          style={{ animationDelay: `${(i < 2 ? i * 140 : 0) + 220}ms` }}
        >
          {circle.label.lines.map((line, li) => (
            <tspan key={li} x={circle.label.x} y={circle.label.ys[li]}>{line}</tspan>
          ))}
        </text>
      ))}

      {/* The focus slides down into the triple overlap when the hint circle arrives,
          so the `?` never ends up outside the area the new circle leaves. */}
      <g className="venn-diagram__focus" style={{ transform: `translate(${focus.x}px, ${focus.y}px)` }}>
        {layout.pill && solution ? (
          <g className="venn-diagram__solved" key={`${diagramKey}-solved`}>
            <rect
              className="venn-diagram__pill"
              x={-layout.pill.width / 2}
              y={-layout.pill.height / 2}
              width={layout.pill.width}
              height={layout.pill.height}
              rx={layout.pill.height / 2}
            />
            <text
              className="venn-diagram__solution"
              x={0}
              y={0}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={layout.pill.fontSize}
            >
              {solution}
            </text>
          </g>
        ) : (
          <text
            key={`${diagramKey}-unknown`}
            className="venn-diagram__unknown"
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={VENN_UNKNOWN_FONT_SIZE}
          >
            ?
          </text>
        )}
      </g>
    </svg>
  );
}
