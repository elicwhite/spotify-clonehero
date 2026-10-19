export const STORAGE_PATH = '/storage';

/**
 * The row holding the song-library database, and the anchor another page links
 * to when it sends someone here to reset it.
 *
 * A shared constant rather than a string at each end: a link and a row that
 * were meant to agree on one name and do not is a bug that looks like nothing
 * — the page loads, and the user lands at the top with no idea which row was
 * meant.
 */
export const LOCAL_DB_ANCHOR = 'song-library-database';

/** Links straight to that row. */
export const LOCAL_DB_RESET_PATH = `${STORAGE_PATH}#${LOCAL_DB_ANCHOR}`;
