/**
 * Some of these utilities are taken from Encore's frontend
 * Taken from https://github.com/Geomitron/chorus-encore/blob/master/src-shared/utils.ts#L88
 */

// prettier-ignore
const allowedTags = [
	'align', 'allcaps', 'alpha', 'b', 'br', 'color', 'cspace', 'font', 'font-weight',
	'gradient', 'i', 'indent', 'line-height', 'line-indent', 'link', 'lowercase',
	'margin', 'mark', 'mspace', 'nobr', 'noparse', 'page', 'pos', 'rotate', 's',
	'size', 'smallcaps', 'space', 'sprite', 'strikethrough', 'style', 'sub', 'sup',
	'u', 'uppercase', 'voffset', 'width',
]

const tagPattern = allowedTags.map(tag => `\\b${tag}\\b`).join('|');

/**
 * @returns `text` with all style tags removed. (e.g. "<color=#AEFFFF>Aren Eternal</color> & Geo" -> "Aren Eternal & Geo")
 */
export function removeStyleTags(text: string) {
  let oldText = text;
  let newText = text;
  do {
    oldText = newText;
    newText = newText
      .replace(new RegExp(`<\\s*\\/?\\s*(?:${tagPattern})[^>]*>`, 'gi'), '')
      .trim();
  } while (newText !== oldText);
  return newText;
}
