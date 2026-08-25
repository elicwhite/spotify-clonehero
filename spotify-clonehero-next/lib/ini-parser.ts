// Taken from scan-chart: https://www.npmjs.com/package/scan-chart
// https://github.com/Geomitron/scan-chart

export const $NoSection: unique symbol = Symbol('Lines before any sections');

/**
 * A parsed ini file. Section names and keys are both lower-cased, so a lookup
 * is spelled one way whatever the file says. Charts in the wild write the same
 * section as `[Song]`, `[song]` and `[SONG]`, and a lookup that knows only some
 * of those spellings drops the whole chart without a word.
 */
export interface IniObject {
  [$NoSection]?: {[key: string]: string};
  [section: string]: {[key: string]: string};
}

function createParseError(line: string) {
  return `Unsupported type of line: "${line}"`;
}

/**
 * @returns the most likely text encoding for the text in `buffer`.
 */
function getEncoding(buffer: Uint8Array) {
  if (buffer.length < 2) {
    return 'utf-8';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'utf-16le';
  }

  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return 'utf-16be';
  }

  return 'utf-8';
}

export function parse(file: Uint8Array) {
  const iniObject: IniObject = {};
  const iniErrors: string[] = [];

  let currentSection = '';

  // The parser takes bytes, not text, because Windows chart tools write
  // song.ini as UTF-16. Decoded as UTF-8, such a file gives no recognizable
  // `[Song]` header, so it parses to no sections and the chart appears to
  // have no metadata. TextDecoder drops a UTF-8 byte-order mark on its own.
  const data = new TextDecoder(getEncoding(file)).decode(file);
  const lines = data.split(/\r?\n/g).map(line => line.trim());
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(';')) {
      continue;
    }

    if (line[0].startsWith('[')) {
      const match = /\[(.+)]$/.exec(line);
      if (match === null) {
        iniErrors.push(createParseError(line));
      } else {
        currentSection = match[1].trim().toLowerCase();
      }
    } else if (line.includes('=')) {
      const delimeterPos = line.indexOf('=');
      const key = line.slice(0, delimeterPos).trim().toLowerCase();
      const value = line.slice(delimeterPos + 1).trim();

      if (currentSection === '') {
        (iniObject[$NoSection] ??= {})[key] = value;
      } else {
        (iniObject[currentSection] ??= {})[key] = value;
      }
    } else {
      iniErrors.push(createParseError(line));
    }
  }

  return {iniObject, iniErrors};
}
