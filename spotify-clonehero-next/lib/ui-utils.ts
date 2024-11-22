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

export function calculateTimeRemaining(
  startTime: Date,
  totalNum: number,
  currentNum: number,
  defaultEstimate: number,
): number {
  const currentTime = new Date();
  const timeElapsed = currentTime.getTime() - startTime.getTime();

  const timePerItemSoFar =
    currentNum > 0 ? timeElapsed / currentNum : defaultEstimate;
  const chartsRemaining = totalNum - currentNum;
  const timeRemaining = chartsRemaining * timePerItemSoFar;

  return timeRemaining;
}

export function formatTimeRemaining(timeInMillis: number) {
  const seconds = Math.ceil(timeInMillis / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  let formattedTime;

  if (hours > 0) {
    // Use hours if the time is more than 1 hour
    formattedTime = `${hours} ${hours === 1 ? 'hour' : 'hours'} remaining`;
  } else if (minutes > 0) {
    // Use minutes if the time is less than 1 hour but more than 1 minute
    formattedTime = `${minutes} ${
      minutes === 1 ? 'minute' : 'minutes'
    } remaining`;
  } else {
    // Use seconds if the time is less than 1 minute
    formattedTime = `${seconds} ${
      seconds === 1 ? 'second' : 'seconds'
    } remaining`;
  }

  return formattedTime;
}
