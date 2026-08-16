import {LANE_VARS} from '@/components/landing/lanes';

/**
 * One bar of drum notation, drawn the way `/sheet-music` draws it: percussion
 * clef, 4/4, stems up, eighths beamed a beat at a time, X noteheads for
 * cymbals and oval heads for drums, and the crash on the first ledger line
 * above the staff.
 *
 * Staff positions follow `app/sheet-music/[slug]/renderVexflow.ts`: hi-hat
 * above the top line, snare in the third space, kick in the first space. Note
 * colors are the same lane colors that renderer assigns, read here from the
 * `.landing-lanes` custom properties so the bar tracks the theme.
 *
 * ## Why the ink is graded rather than one color
 *
 * Everything is `currentColor` at four different opacities, brightest for
 * stems and beams and dimmest for the staff lines, with the gap widened in
 * dark mode (`--staff-ink` and friends below).
 *
 * Notation renderers ship one of two things: light paper inside dark chrome
 * (Soundslice, Dorico, MuseScore's default), or a straight inversion to
 * `#fff` on `#000` (OpenSheetMusicDisplay's `darkMode`, MuseScore's "invert
 * score"). Nobody publishes a tuned dark palette, and the inversion is what
 * their own users file bugs about, because of irradiation: a light shape on a
 * dark ground scatters inside the eye and reads larger than the same shape
 * drawn dark on light. Five hairlines a staff space apart bloom into each
 * other and the staff turns into a grey band that outshouts the gems, which
 * are the subject of this picture.
 *
 * So the staff lines are drawn dimmer and thinner than the stems. That is a
 * dark-mode correction rather than engraving practice: Bravura's
 * `engravingDefaults` actually put staff lines (0.13 spaces) marginally
 * *thicker* than stems (0.12). They stay above the 3:1 contrast floor WCAG
 * 1.4.11 sets for a graphical object.
 *
 * A picture of what the tool shows rather than a working staff, so it is
 * hidden from assistive tech; the band's copy names what it shows.
 */

/** Staff lines, top to bottom. A space is 10 units, a half-space 5. */
const STAFF_LINES = [45, 55, 65, 75, 85];

/** The eighth-note grid across the bar. */
const COLUMNS = [86, 134, 182, 230, 278, 326, 374, 422];

/** Stems sit on the right edge of the notehead and rise to the beam. */
const STEM_X = 5.6;
const BEAM_TOP = 20;
const BEAM_BOTTOM = 25;

const CRASH_Y = 35;
const HIHAT_Y = 40;
const SNARE_Y = 60;
const KICK_Y = 80;

/** Beat 1 takes a crash instead of a hi-hat; the rest of the bar is hats. */
const CRASH_COLUMN = COLUMNS[0];
const HIHAT_COLUMNS = COLUMNS.slice(1);
const SNARE_COLUMNS = [COLUMNS[2], COLUMNS[6]];
const KICK_COLUMNS = [COLUMNS[0], COLUMNS[3], COLUMNS[4]];

/**
 * The ink ladder, as opacities over `currentColor`. Light mode needs far less
 * separation than dark, because dark ink on a light ground does not bloom.
 */
const INK = {
  note: 'var(--note-ink)',
  chrome: 'var(--chrome-ink)',
  barline: 'var(--barline-ink)',
  staff: 'var(--staff-ink)',
} as const;

const INK_SCALE = [
  '[--note-ink:1]',
  '[--chrome-ink:0.82]',
  '[--barline-ink:0.68]',
  '[--staff-ink:0.62]',
  'dark:[--note-ink:0.88]',
  'dark:[--chrome-ink:0.68]',
  'dark:[--barline-ink:0.46]',
  'dark:[--staff-ink:0.42]',
].join(' ');

/** The lowest notehead in a column, which is where that column's stem starts. */
function stemFoot(x: number): number {
  if (KICK_COLUMNS.includes(x)) return KICK_Y;
  if (SNARE_COLUMNS.includes(x)) return SNARE_Y;
  return HIHAT_Y;
}

function XHead({x, y, color}: {x: number; y: number; color: string}) {
  return (
    <g
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke">
      <line x1={x - 5.5} x2={x + 5.5} y1={y - 4.5} y2={y + 4.5} />
      <line x1={x + 5.5} x2={x - 5.5} y1={y - 4.5} y2={y + 4.5} />
    </g>
  );
}

function OvalHead({x, y, color}: {x: number; y: number; color: string}) {
  return (
    <ellipse
      cx={x}
      cy={y}
      rx="6.4"
      ry="4.6"
      fill={color}
      transform={`rotate(-22 ${x} ${y})`}
    />
  );
}

export function DrumNotationBar() {
  return (
    <div
      className={`flex w-full items-center rounded-lg border border-border bg-card p-4 text-foreground ${INK_SCALE}`}>
      <svg
        viewBox="0 6 470 92"
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true">
        {/*
          crispEdges on the staff-line group only: five near-parallel hairlines
          antialias into a band at this render size. Never on the glyphs, which
          need their curves smoothed.
        */}
        <g shapeRendering="crispEdges">
          {STAFF_LINES.map(y => (
            <line
              key={y}
              x1="14"
              x2="452"
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth="1.1"
              style={{strokeOpacity: INK.staff}}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        {/* Percussion clef: two thick strokes spanning the middle two spaces. */}
        <g fill="currentColor" style={{fillOpacity: INK.chrome}}>
          <rect x="22" y="55" width="5.5" height="20" />
          <rect x="32" y="55" width="5.5" height="20" />
          <text
            x="47"
            y="63"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize="22"
            fontWeight="700">
            4
          </text>
          <text
            x="47"
            y="84"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize="22"
            fontWeight="700">
            4
          </text>
        </g>

        {/* Final barline: brighter than the staff so the bar reads as bounded. */}
        <g fill="currentColor" style={{fillOpacity: INK.barline}}>
          <rect x="446" y="45" width="1.6" height="40" />
          <rect x="450.5" y="45" width="4" height="40" />
        </g>

        <g
          stroke="currentColor"
          style={{strokeOpacity: INK.note}}
          fill="currentColor"
          fillOpacity={INK.note}>
          {COLUMNS.map(x => (
            <line
              key={`stem-${x}`}
              x1={x + STEM_X}
              x2={x + STEM_X}
              y1={stemFoot(x)}
              y2={BEAM_BOTTOM}
              strokeWidth="1.3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Eighths beam in pairs, one beam per beat. */}
          {[0, 2, 4, 6].map(i => (
            <rect
              key={`beam-${i}`}
              x={COLUMNS[i] + STEM_X - 0.8}
              y={BEAM_TOP}
              width={COLUMNS[i + 1] - COLUMNS[i] + 1.6}
              height={BEAM_BOTTOM - BEAM_TOP}
              stroke="none"
            />
          ))}
        </g>

        {/* The crash sits a ledger line above the staff. */}
        <line
          x1={CRASH_COLUMN - 10}
          x2={CRASH_COLUMN + 10}
          y1={CRASH_Y}
          y2={CRASH_Y}
          stroke="currentColor"
          strokeWidth="1.3"
          style={{strokeOpacity: INK.barline}}
          vectorEffect="non-scaling-stroke"
        />
        <XHead x={CRASH_COLUMN} y={CRASH_Y} color={LANE_VARS.green} />

        {HIHAT_COLUMNS.map(x => (
          <XHead key={`hat-${x}`} x={x} y={HIHAT_Y} color={LANE_VARS.yellow} />
        ))}
        {SNARE_COLUMNS.map(x => (
          <OvalHead
            key={`snare-${x}`}
            x={x}
            y={SNARE_Y}
            color={LANE_VARS.red}
          />
        ))}
        {KICK_COLUMNS.map(x => (
          <OvalHead key={`kick-${x}`} x={x} y={KICK_Y} color={LANE_VARS.kick} />
        ))}
      </svg>
    </div>
  );
}
