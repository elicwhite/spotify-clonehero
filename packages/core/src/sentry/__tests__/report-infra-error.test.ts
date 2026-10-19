/**
 * @jest-environment jsdom
 */
/**
 * The promise these tests hold to is that a file name the user chose cannot
 * reach Sentry through an error message. Everything else here is grouping.
 */

import * as Sentry from '@sentry/nextjs';

import {reportInfraError} from '../report-infra-error';

jest.mock('@sentry/nextjs', () => ({captureException: jest.fn()}));

const captureException = Sentry.captureException as jest.Mock;

/** What was sent: the exception and its options, as one searchable string. */
function sent(): string {
  const [error, options] = captureException.mock.calls[0] ?? [];
  return JSON.stringify({
    name: (error as Error)?.name,
    message: (error as Error)?.message,
    stack: (error as Error)?.stack,
    options,
  });
}

beforeEach(() => captureException.mockClear());

test('the original message never reaches Sentry', () => {
  const error = new Error('Failed to read My Secret Song (demo).chart');

  reportInfraError(error, {
    summary: 'assist run failed at download-beat-model',
    tags: {task: 'generate-tempo-map'},
  });

  expect(captureException).toHaveBeenCalledTimes(1);
  expect(sent()).not.toContain('My Secret Song');
  expect(sent()).not.toContain('.chart');
});

test('the error class survives, so quota and network group apart', () => {
  reportInfraError(new DOMException('out of room', 'QuotaExceededError'), {
    summary: 'chart open failed',
    tags: {reason: 'storage-error'},
  });
  reportInfraError(new TypeError('Failed to fetch'), {
    summary: 'chart open failed',
    tags: {reason: 'storage-error'},
  });

  const [first] = captureException.mock.calls[0];
  const [second] = captureException.mock.calls[1];
  expect(first.name).toBe('QuotaExceededError');
  expect(second.name).toBe('TypeError');
  expect(first.message).toContain('chart open failed');
});

test('the tags are passed through', () => {
  reportInfraError(new Error('nope'), {
    summary: 'assist run failed at separating',
    tags: {task: 'transcribe-drums', step: 'separating', origin: 'tempo'},
  });

  expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
    tags: {task: 'transcribe-drums', step: 'separating', origin: 'tempo'},
  });
});

test('the stack is kept, because its frames are our own code', () => {
  const error = new Error('whatever');
  error.stack = 'Error: whatever\n    at runTask (assist/tasks.ts:1:1)';

  reportInfraError(error, {summary: 'assist run failed', tags: {}});

  expect(captureException.mock.calls[0][0].stack).toContain('runTask');
});

test('a thrown non-Error is reported rather than dropped', () => {
  reportInfraError('just a string', {summary: 'assist run failed', tags: {}});

  expect(captureException).toHaveBeenCalledTimes(1);
  expect(captureException.mock.calls[0][0].name).toBe('string');
});

test('reporting a failure never becomes one', () => {
  captureException.mockImplementationOnce(() => {
    throw new Error('Sentry is down');
  });

  expect(() =>
    reportInfraError(new Error('nope'), {summary: 'x', tags: {}}),
  ).not.toThrow();
});
