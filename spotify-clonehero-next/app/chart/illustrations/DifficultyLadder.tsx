import {LANE_VARS} from '@/components/landing/lanes';

/**
 * What difficulty generation produces: the same bar of Expert, thinned three
 * times. Reading down, each row keeps fewer of the row above it, which is the
 * whole claim the band makes beside it.
 *
 * Gems are the piano roll's rounded rects in the landing lane colors, so the
 * picture belongs to the same family as the transcription and tempo canvases.
 */

const ROWS: {label: string; columns: number[]}[] = [
  {label: 'EXPERT', columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]},
  {label: 'HARD', columns: [0, 2, 4, 6, 8, 10, 12]},
  {label: 'MEDIUM', columns: [0, 4, 8, 12]},
  {label: 'EASY', columns: [0, 6]},
];

const LANE_CYCLE = [
  LANE_VARS.red,
  LANE_VARS.yellow,
  LANE_VARS.blue,
  LANE_VARS.green,
  LANE_VARS.kick,
];

const ROW_HEIGHT = 36;
const FIRST_ROW_Y = 15;
const FIRST_COLUMN_X = 78;
const COLUMN_STEP = 30;

export function DifficultyLadder() {
  return (
    <div className="flex h-32 w-full items-center rounded-lg border border-border bg-card px-3 sm:h-40">
      <svg
        viewBox="0 0 480 152"
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true">
        {ROWS.map((row, rowIndex) => (
          <g key={row.label}>
            <text
              x="8"
              y={FIRST_ROW_Y + rowIndex * ROW_HEIGHT + 10}
              className="fill-muted-foreground font-mono"
              fontSize="11">
              {row.label}
            </text>
            {row.columns.map(column => (
              <rect
                key={column}
                x={FIRST_COLUMN_X + column * COLUMN_STEP}
                y={FIRST_ROW_Y + rowIndex * ROW_HEIGHT}
                width="18"
                height="12"
                rx="3"
                fill={LANE_CYCLE[column % LANE_CYCLE.length]}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
