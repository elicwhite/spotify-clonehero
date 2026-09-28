import {useId} from 'react';

/**
 * A document-unique id for an SVG filter, gradient or clip path, usable in
 * `url(#id)`: React's `useId` with the characters CSS ids reject removed.
 * Every instance gets its own, so any number can be on screen at once.
 */
export const useFilterId = (prefix: string): string =>
  `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
