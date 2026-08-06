/**
 * @jest-environment jsdom
 */
/**
 * The tempo lane's tap-tempo tool: the key handling that makes "tap any key"
 * safe (typing still types, the popover's own buttons still activate), the
 * three-way Reset / Cancel / Accept split, and the transport button.
 */

import '@testing-library/jest-dom';
import {act, fireEvent, render, screen} from '@testing-library/react';
import TapTempoPopover, {type TapTempoTransport} from '../TapTempoPopover';

/** Dispatch a keydown with a controlled input timestamp, since the fit reads
 *  `event.timeStamp` and jsdom stamps every synthetic event with "now". */
function tapKey(
  key: string,
  timeStamp: number,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'timeStamp', {value: timeStamp});
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function tapEvenly(count: number, periodMs = 500, start = 1000) {
  for (let i = 0; i < count; i++) tapKey('k', start + i * periodMs);
}

class FakeTransport implements TapTempoTransport {
  isPlaying = false;
  tempo = 1;
  played: number[] = [];
  paused = 0;
  getCurrentTempo() {
    return this.tempo;
  }
  playChartTime(sec: number) {
    this.played.push(sec);
    this.isPlaying = true;
  }
  pause() {
    this.paused += 1;
    this.isPlaying = false;
  }
}

function mount(overrides: Partial<Parameters<typeof TapTempoPopover>[0]> = {}) {
  const transport = new FakeTransport();
  const onAccept = jest.fn();
  const onCancel = jest.fn();
  const view = render(
    <TapTempoPopover
      anchorTick={3840}
      anchorMs={4000}
      anchorLabel="40.1"
      audioManager={transport}
      onAccept={onAccept}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return {transport, onAccept, onCancel, ...view};
}

const pad = () => screen.getByRole('button', {name: /Tap here/});
const accept = () => screen.getByRole('button', {name: 'Accept'});

describe('TapTempoPopover key handling', () => {
  it('records an ordinary key as a tap and consumes it', () => {
    mount();
    const event = tapKey('k', 1000);
    expect(event.defaultPrevented).toBe(true);
    tapKey('j', 1500);
    tapKey('l', 2000);
    expect(screen.getByText('120.0')).toBeInTheDocument();
  });

  it('ignores auto-repeat, Escape and modified chords', () => {
    mount();
    tapEvenly(4);

    const repeat = tapKey('k', 3000, {repeat: true});
    const escape = tapKey('Escape', 3200);
    const undo = tapKey('z', 3400, {metaKey: true});

    expect(repeat.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
    expect(undo.defaultPrevented).toBe(false);
    expect(screen.getByText(/from 4 taps/)).toBeInTheDocument();
  });

  it('leaves typing in an input alone', () => {
    mount();
    tapEvenly(4);
    const input = document.createElement('input');
    document.body.appendChild(input);

    const typed = tapKey('a', 3000, {}, input);

    expect(typed.defaultPrevented).toBe(false);
    expect(screen.getByText(/from 4 taps/)).toBeInTheDocument();
    input.remove();
  });

  it('lets a key on its own controls activate them instead of tapping', () => {
    mount();
    tapEvenly(4);

    const enter = tapKey('Enter', 3000, {}, accept());

    expect(enter.defaultPrevented).toBe(false);
    expect(screen.getByText(/from 4 taps/)).toBeInTheDocument();
  });

  it('taps from the pad itself', () => {
    mount();
    tapEvenly(3);
    const onPad = tapKey('k', 2500, {}, pad());
    expect(onPad.defaultPrevented).toBe(true);
    expect(screen.getByText(/from 4 taps/)).toBeInTheDocument();
  });
});

describe('TapTempoPopover controls', () => {
  it('focuses the tap pad on mount and again after Reset', () => {
    mount();
    expect(pad()).toHaveFocus();

    tapEvenly(4);
    accept().focus();
    act(() => {
      screen.getByRole('button', {name: 'Reset'}).click();
    });

    expect(pad()).toHaveFocus();
    expect(screen.getByText('--')).toBeInTheDocument();
    expect(screen.getByText(/Tap here/)).toBeInTheDocument();
  });

  it('enables Accept only from four taps, and reports full precision', () => {
    const {onAccept} = mount();
    tapEvenly(3);
    expect(screen.getByText('120.0')).toBeInTheDocument();
    expect(accept()).toBeDisabled();

    tapKey('k', 1000 + 3 * 500);
    expect(accept()).toBeEnabled();
    act(() => {
      accept().click();
    });
    expect(onAccept).toHaveBeenCalledWith(120);
  });

  it('renders the BPM to exactly one decimal', () => {
    // 405 ms taps fit to 148.148…; the readout rounds, the accepted value
    // does not.
    const {onAccept} = mount();
    tapEvenly(5, 405);
    expect(screen.getByText('148.1')).toBeInTheDocument();
    act(() => {
      accept().click();
    });
    expect(onAccept.mock.calls[0][0]).toBeCloseTo(60000 / 405, 9);
  });

  it('corrects half and double time without re-tapping', () => {
    const {onAccept} = mount();
    tapEvenly(5);
    act(() => {
      screen.getByRole('button', {name: '×2'}).click();
    });
    expect(screen.getByText('240.0')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', {name: '÷2'}).click();
      screen.getByRole('button', {name: '÷2'}).click();
    });
    expect(screen.getByText('60.0')).toBeInTheDocument();
    act(() => {
      accept().click();
    });
    expect(onAccept).toHaveBeenCalledWith(60);
  });

  it('cancels without dispatching', () => {
    const {onAccept, onCancel} = mount();
    tapEvenly(5);
    act(() => {
      screen.getByRole('button', {name: 'Cancel'}).click();
    });
    expect(onCancel).toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe('TapTempoPopover transport', () => {
  it('seeks to the anchor on play and keeps the taps on pause', () => {
    const {transport} = mount();
    tapEvenly(5);

    act(() => {
      fireEvent.click(screen.getByRole('button', {name: 'Play from 40.1'}));
    });
    expect(transport.played).toEqual([4]);
    expect(screen.getByRole('button', {name: 'Pause'})).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', {name: 'Pause'}));
    });
    expect(transport.paused).toBe(1);
    expect(screen.getByText(/from 5 taps/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'Play from 40.1'}),
    ).toBeInTheDocument();
  });

  it('scales the fit by the playback rate and resets when the rate changes', () => {
    jest.useFakeTimers();
    try {
      const {transport} = mount();
      transport.tempo = 0.75;
      act(() => {
        jest.advanceTimersByTime(200);
      });

      tapEvenly(5);
      // 500 ms of wall time at 0.75x is 375 ms of song time: 160 BPM.
      expect(screen.getByText('160.0')).toBeInTheDocument();

      transport.tempo = 1;
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(screen.getByText('--')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
