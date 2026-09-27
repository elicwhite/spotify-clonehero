/**
 * @jest-environment jsdom
 */

import {act, renderHook} from '@testing-library/react';
import {track} from '../../../../lib/analytics/track';
import type {AudioManager} from '../../../../lib/preview/audioManager';
import {usePlaybackAnalytics} from '../usePlaybackAnalytics';

jest.mock('../../../../lib/analytics/track', () => ({track: jest.fn()}));

const trackMock = track as jest.MockedFunction<typeof track>;

/** Stands in for an AudioManager: only its rendered-audio clock is read. */
function fakeManager(renderedSeconds: number) {
  return {renderedSeconds} as {renderedSeconds: number} & AudioManager;
}

function sessionSeconds(): number[] {
  return trackMock.mock.calls
    .map(([event]) => event)
    .filter(event => event.event === 'sheet_music_playback_session')
    .map(event => ('playSeconds' in event ? event.playSeconds : NaN));
}

function eventNames(): string[] {
  return trackMock.mock.calls.map(([event]) => event.event);
}

type Props = {manager: AudioManager | null; playing: boolean};

function renderPlayback(initial: Props) {
  return renderHook(
    ({manager, playing}: Props) => usePlaybackAnalytics(manager, playing),
    {initialProps: initial},
  );
}

beforeEach(() => {
  trackMock.mockClear();
  jest.useRealTimers();
});

describe('usePlaybackAnalytics', () => {
  test('a play-to-pause segment reports the seconds of audio rendered', () => {
    const manager = fakeManager(10);
    const {rerender} = renderPlayback({manager, playing: false});
    rerender({manager, playing: true});
    manager.renderedSeconds = 25;
    rerender({manager, playing: false});

    expect(eventNames()).toEqual([
      'sheet_music_play',
      'sheet_music_pause',
      'sheet_music_playback_session',
    ]);
    expect(sessionSeconds()).toEqual([15]);
  });

  test('wall-clock time with no rendered audio does not count', () => {
    // The device sleeps for a day with the page still in its playing state.
    // The wall clock advances; the audio clock does not.
    jest.useFakeTimers({now: 0});
    const manager = fakeManager(5);
    const {rerender} = renderPlayback({manager, playing: false});
    rerender({manager, playing: true});
    manager.renderedSeconds = 65;
    jest.setSystemTime(24 * 60 * 60 * 1000);
    rerender({manager, playing: false});

    expect(sessionSeconds()).toEqual([60]);
  });

  test('one segment continues across a replaced AudioManager', () => {
    // A difficulty change rebuilds the manager during playback. The state
    // goes to null and then to the new manager, whose clock starts at zero.
    const first = fakeManager(100);
    const {rerender} = renderPlayback({manager: first, playing: false});
    rerender({manager: first, playing: true});
    first.renderedSeconds = 130;
    rerender({manager: null, playing: true});
    first.renderedSeconds = 500; // the destroyed manager is not read again

    const second = fakeManager(0);
    rerender({manager: second, playing: true});
    second.renderedSeconds = 20;
    rerender({manager: second, playing: false});

    expect(eventNames()).toEqual([
      'sheet_music_play',
      'sheet_music_pause',
      'sheet_music_playback_session',
    ]);
    expect(sessionSeconds()).toEqual([50]);
  });

  test('pagehide while playing reports the segment so far', () => {
    const manager = fakeManager(0);
    const {rerender} = renderPlayback({manager, playing: false});
    rerender({manager, playing: true});
    manager.renderedSeconds = 30;
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(sessionSeconds()).toEqual([30]);

    // If the page comes back and plays on, only the new time is reported.
    manager.renderedSeconds = 40;
    rerender({manager, playing: false});
    expect(sessionSeconds()).toEqual([30, 10]);
  });

  test('unmount while playing reports the segment', () => {
    const manager = fakeManager(0);
    const {rerender, unmount} = renderPlayback({manager, playing: false});
    rerender({manager, playing: true});
    manager.renderedSeconds = 42;
    unmount();

    expect(sessionSeconds()).toEqual([42]);
  });

  test('time while paused does not join the next segment', () => {
    const manager = fakeManager(0);
    const {rerender} = renderPlayback({manager, playing: false});
    rerender({manager, playing: true});
    manager.renderedSeconds = 5;
    rerender({manager, playing: false});
    manager.renderedSeconds = 100;
    rerender({manager, playing: true});
    manager.renderedSeconds = 108;
    rerender({manager, playing: false});

    expect(sessionSeconds()).toEqual([5, 8]);
  });

  test('a segment shorter than a second sends no session', () => {
    const manager = fakeManager(0);
    const {rerender} = renderPlayback({manager, playing: false});
    rerender({manager, playing: true});
    manager.renderedSeconds = 0.4;
    rerender({manager, playing: false});

    expect(eventNames()).toEqual(['sheet_music_play', 'sheet_music_pause']);
  });

  test('no pause is sent without a play', () => {
    const {rerender, unmount} = renderPlayback({
      manager: fakeManager(0),
      playing: false,
    });
    rerender({manager: fakeManager(0), playing: false});
    unmount();

    expect(eventNames()).toEqual([]);
  });
});
