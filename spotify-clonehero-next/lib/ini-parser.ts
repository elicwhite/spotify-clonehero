// Taken from scan-chart: https://www.npmjs.com/package/scan-chart
// https://github.com/Geomitron/scan-chart

export const $NoSection: unique symbol = Symbol('Lines before any sections');
export interface IniObject {
  [$NoSection]?: {[key: string]: string};
  [section: string]: {[key: string]: string};
}

function createParseError(line: string) {
  return `Unsupported type of line: "${line}"`;
}

export function parse(data: string) {
  const iniObject: IniObject = {};
  const iniErrors: string[] = [];

  let currentSection = '';

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
        currentSection = match[1].trim();
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
