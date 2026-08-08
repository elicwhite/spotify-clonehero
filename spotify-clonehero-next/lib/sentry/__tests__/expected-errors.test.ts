import {isExpectedUserFlowEvent} from '@/lib/sentry/expected-errors';

function exceptionEvent(value: string) {
  return {exception: {values: [{value}]}};
}

describe('expected Sentry errors', () => {
  it.each([
    'User canceled picker',
    'Not authenticated or no Spotify token',
    'The request is not allowed by the user agent or the platform in the current context.',
    'Spotify History: Did not expect to see subfolders. Found folder export.',
    'Spotify History: Unexpected file contents in history.json. Are you sure?',
    'Spotify History: Expected to find a ReadMeFirst.pdf file. Are you sure?',
    "Failed to execute 'getFile' on 'FileSystemFileHandle': permission denied",
    'Bad OAuth request. Body: Spotify is unavailable in this country',
  ])('filters %s', message => {
    expect(isExpectedUserFlowEvent(exceptionEvent(message))).toBe(true);
  });

  it('checks top-level event messages', () => {
    expect(isExpectedUserFlowEvent({message: 'User canceled picker'})).toBe(
      true,
    );
  });

  it.each([
    'Bad OAuth request. Body: Insufficient client scope',
    'Expected cached Spotify dump to be an array',
    'Error scanning sng file Songs/broken.sng',
    'The request failed because of an application defect',
  ])('keeps actionable error %s', message => {
    expect(isExpectedUserFlowEvent(exceptionEvent(message))).toBe(false);
  });
});
