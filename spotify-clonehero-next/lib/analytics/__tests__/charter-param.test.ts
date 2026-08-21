/**
 * The one raw string the export event sends (plan 0105).
 */

import {charterParam, UNCREDITED_CHARTER} from '../charter-param';
import {MAX_GA_PARAM_LENGTH} from '../limits';

test('a normal credit is sent as written', () => {
  expect(charterParam('TheCharterName')).toBe('TheCharterName');
});

test('surrounding space is not part of the credit', () => {
  expect(charterParam('  TheCharterName \n')).toBe('TheCharterName');
});

test('a chart crediting nobody says so, rather than sending a blank', () => {
  expect(charterParam('')).toBe(UNCREDITED_CHARTER);
  expect(charterParam('   ')).toBe(UNCREDITED_CHARTER);
  expect(charterParam(undefined)).toBe(UNCREDITED_CHARTER);
});

test('an over-long credit is truncated rather than dropped by GA4', () => {
  const long = 'x'.repeat(MAX_GA_PARAM_LENGTH + 50);
  expect(charterParam(long)).toHaveLength(MAX_GA_PARAM_LENGTH);
});
