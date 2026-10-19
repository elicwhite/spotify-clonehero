/**
 * GA4 platform limits the event parameters have to respect.
 *
 * Separate from any one parameter's module: it is a property of the
 * platform, and putting it in whichever feature happened to need it first
 * makes the others import that feature for it.
 */

/** GA4 drops an event parameter whose value runs past this many characters,
 *  so a value that can exceed it must be shortened rather than sent. */
export const MAX_GA_PARAM_LENGTH = 100;
