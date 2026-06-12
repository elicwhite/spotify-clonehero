/**
 * Clone Hero MIDI Profile parsing.
 *
 * Clone Hero stores e-drum mappings as a small YAML file with the structure:
 *
 *   DeviceName: Alesis Surge
 *   Mappings:
 *     Red Pad:
 *     - NoteNumber: 38
 *       Velocity: 10
 *       OverHitThreshold: 0
 *     ...
 *
 * The format is simple and regular, so it is hand-parsed here to avoid pulling
 * in a YAML dependency. Only the subset Clone Hero emits is supported.
 */

/** Pad names recognised in a Clone Hero MIDI profile. */
export type ChPadName =
  | 'Red Pad'
  | 'Yellow Pad'
  | 'Blue Pad'
  | 'Green Pad'
  | 'Kick Pad'
  | 'Yellow Cymbal'
  | 'Blue Cymbal'
  | 'Green Cymbal';

export const CH_PAD_NAMES: readonly ChPadName[] = [
  'Red Pad',
  'Yellow Pad',
  'Blue Pad',
  'Green Pad',
  'Kick Pad',
  'Yellow Cymbal',
  'Blue Cymbal',
  'Green Cymbal',
];

/** A single MIDI note → pad assignment within a profile. */
export interface ChProfileMapping {
  noteNumber: number;
  velocity: number;
  overHitThreshold: number;
}

/** A parsed Clone Hero MIDI profile. */
export interface ChProfile {
  deviceName: string;
  /** Pad name → list of MIDI note assignments. */
  mappings: Partial<Record<ChPadName, ChProfileMapping[]>>;
}

/**
 * The built-in Alesis Surge mapping, embedded so the tool works out of the box
 * without the user supplying a profile file.
 */
export const ALESIS_SURGE_PROFILE: ChProfile = {
  deviceName: 'Alesis Surge',
  mappings: {
    'Kick Pad': [mapping(36)],
    'Red Pad': [mapping(38), mapping(40)],
    'Yellow Pad': [mapping(48), mapping(50)],
    'Blue Pad': [mapping(45), mapping(47)],
    'Green Pad': [mapping(41), mapping(43), mapping(58)],
    'Yellow Cymbal': [mapping(22), mapping(42), mapping(23)],
    'Blue Cymbal': [mapping(51), mapping(46)],
    'Green Cymbal': [mapping(49)],
  },
};

function mapping(
  noteNumber: number,
  velocity = 10,
  overHitThreshold = 0,
): ChProfileMapping {
  return {noteNumber, velocity, overHitThreshold};
}

const KNOWN_PAD_NAMES = new Set<string>(CH_PAD_NAMES);

/**
 * Parse a Clone Hero MIDI profile from its YAML text.
 *
 * Only the `DeviceName` and `Mappings` structure Clone Hero emits is handled.
 * Indentation drives nesting: pad names are indented under `Mappings:`, and
 * each list item (`- NoteNumber: …`) carries `Velocity` / `OverHitThreshold`
 * on following indented lines. Unknown pad names are ignored; empty lists
 * (e.g. `Start: []`) are accepted and produce no entries.
 */
export function parseChProfile(yaml: string): ChProfile {
  const profile: ChProfile = {deviceName: '', mappings: {}};

  const lines = yaml.split(/\r?\n/);

  let inMappings = false;
  let mappingsIndent = -1;
  let currentPad: ChPadName | null = null;
  let currentList: ChProfileMapping[] | null = null;
  let currentItem: ChProfileMapping | null = null;

  for (const rawLine of lines) {
    // Strip comments and trailing whitespace, but keep leading indentation.
    const line = stripComment(rawLine).replace(/\s+$/, '');
    if (line.trim() === '') continue;

    const indent = leadingSpaces(line);
    const content = line.trim();

    // Top-level keys.
    if (indent === 0) {
      inMappings = false;
      currentPad = null;
      currentList = null;
      currentItem = null;

      const dev = matchKeyValue(content, 'DeviceName');
      if (dev !== null) {
        profile.deviceName = unquote(dev);
        continue;
      }
      if (/^Mappings\s*:/.test(content)) {
        inMappings = true;
        mappingsIndent = indent;
        continue;
      }
      continue;
    }

    if (!inMappings || indent <= mappingsIndent) continue;

    // A list item under the current pad.
    if (content.startsWith('-')) {
      if (currentList === null) continue;
      currentItem = {noteNumber: NaN, velocity: 0, overHitThreshold: 0};
      currentList.push(currentItem);
      const afterDash = content.slice(1).trim();
      if (afterDash !== '') applyItemField(currentItem, afterDash);
      continue;
    }

    // A `key: value` line. Could be a pad-name header or an item field.
    const colon = content.indexOf(':');
    if (colon === -1) continue;
    const key = content.slice(0, colon).trim();
    const value = content.slice(colon + 1).trim();

    // Pad-name header (no inline value, or inline empty list `[]`).
    if (KNOWN_PAD_NAMES.has(key)) {
      currentPad = key as ChPadName;
      currentItem = null;
      if (value === '' || value === '[]') {
        currentList = [];
        if (value === '') {
          profile.mappings[currentPad] = currentList;
        } else {
          // Empty inline list — record nothing.
          currentList = null;
        }
      } else {
        currentList = null;
      }
      continue;
    }

    // Unknown header (e.g. Start/Select) — skip its block.
    if (currentItem === null) {
      // A header for a pad we don't track.
      currentPad = null;
      currentList = null;
      continue;
    }

    // Item field line.
    applyItemField(currentItem, content);
  }

  // Drop any pads that ended up with malformed (NaN) note numbers.
  for (const pad of CH_PAD_NAMES) {
    const list = profile.mappings[pad];
    if (!list) continue;
    const cleaned = list.filter(m => Number.isFinite(m.noteNumber));
    if (cleaned.length === 0) {
      delete profile.mappings[pad];
    } else {
      profile.mappings[pad] = cleaned;
    }
  }

  return profile;
}

function applyItemField(item: ChProfileMapping, content: string): void {
  const num = matchKeyValue(content, 'NoteNumber');
  if (num !== null) {
    item.noteNumber = parseInt(num, 10);
    return;
  }
  const vel = matchKeyValue(content, 'Velocity');
  if (vel !== null) {
    item.velocity = parseInt(vel, 10);
    return;
  }
  const over = matchKeyValue(content, 'OverHitThreshold');
  if (over !== null) {
    item.overHitThreshold = parseInt(over, 10);
    return;
  }
}

function matchKeyValue(content: string, key: string): string | null {
  if (!content.startsWith(key)) return null;
  const rest = content.slice(key.length);
  const m = rest.match(/^\s*:\s*(.*)$/);
  if (!m) return null;
  return m[1].trim();
}

function leadingSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}

function stripComment(line: string): string {
  // Remove `#` comments that are not inside quotes. CH profiles don't quote,
  // so a simple split is sufficient.
  const idx = line.indexOf('#');
  if (idx === -1) return line;
  return line.slice(0, idx);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
