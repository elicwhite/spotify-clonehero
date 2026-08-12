/**
 * @jest-environment jsdom
 */
/**
 * Stems mixer (plan 0074 Phase 5, Design C, Suite 6).
 *
 * Under test: `StemsMixer` in isolation, against a stubbed `AudioManager`
 * (the audio boundary — no real Web Audio). Behavior-first: every
 * assertion reads the fake's recorded `setVolume` calls or the rendered
 * row chrome, never internal component state.
 *
 * Rows are selected by `data-testid="stem-row-<track name>"` rather than by
 * the slider's accessible name: the shared `Slider` primitive (Radix) puts
 * `role="slider"` on its Thumb, which doesn't inherit an `aria-label` given
 * to the Root, so a name-based `getByRole` query can't tell rows apart.
 */

import '@testing-library/jest-dom';
import {useMemo, useState} from 'react';
import {act} from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import {TooltipProvider} from '@/components/ui/tooltip';
import type {AudioManager} from '@/lib/preview/audioManager';
import StemsMixer from '../sidebar/StemsMixer';

// jsdom has no ResizeObserver; Radix's Slider needs one.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

// jsdom's File has no `arrayBuffer()`.
if (!('arrayBuffer' in File.prototype)) {
  (
    File.prototype as unknown as {arrayBuffer: () => Promise<ArrayBuffer>}
  ).arrayBuffer = async function (this: File) {
    return new ArrayBuffer(0);
  };
}

// The drop-zone decodes real audio via the browser's AudioContext, which
// jsdom doesn't implement. Stubbed at the same boundary
// `usePaddedAudio.test.tsx` uses for the click track. A relative path
// (not the `@/` alias) — jest.mock can't resolve the alias at hoist time.
const mockInterleaved = new Float32Array([0.1, 0.2, 0.3, 0.4]);
jest.mock('../../../lib/audio-pipeline/decode-audio', () => ({
  decodeAtRate: jest.fn(async () => ({}) as unknown),
  nativeDecodeRate: jest.fn(() => 44100),
}));
jest.mock('../../../lib/drum-transcription/audio/decoder', () => ({
  decodeAudio: jest.fn(async () => ({}) as unknown),
  interleaveAudioBuffer: jest.fn(() => mockInterleaved),
  interleaveAudioBufferYielding: jest.fn(async () => mockInterleaved),
}));

class FakeAudioManager {
  setVolume = jest.fn();
  #trackNames: string[];
  constructor(trackNames: string[]) {
    this.#trackNames = trackNames;
  }
  get trackNames(): readonly string[] {
    return this.#trackNames;
  }
}

function makeAudioManager(trackNames: string[]): AudioManager {
  return new FakeAudioManager(trackNames) as unknown as AudioManager;
}

/** Last volume `setVolume` was called with for `track`, or undefined if
 *  never called. */
function lastVolume(
  audioManager: AudioManager,
  track: string,
): number | undefined {
  const calls = (audioManager.setVolume as jest.Mock).mock.calls as [
    string,
    number,
  ][];
  const forTrack = calls.filter(([name]) => name === track);
  return forTrack.length > 0 ? forTrack[forTrack.length - 1][1] : undefined;
}

function renderMixer(
  props: Omit<React.ComponentProps<typeof StemsMixer>, 'audioManager'> & {
    audioManager: AudioManager;
  },
) {
  return render(
    <TooltipProvider>
      <StemsMixer {...props} />
    </TooltipProvider>,
  );
}

/** The slider (Thumb) inside a given track's row. */
function rowSlider(track: string): HTMLElement {
  return within(screen.getByTestId(`stem-row-${track}`)).getByRole('slider');
}

describe('StemsMixer', () => {
  it('renders one row per AudioManager track, click last', () => {
    const audioManager = makeAudioManager(['song', 'drums', 'click']);
    renderMixer({audioManager});
    expect(screen.getByTestId('stem-row-song')).toBeVisible();
    expect(screen.getByTestId('stem-row-drums')).toBeVisible();
    expect(screen.getByTestId('stem-row-click')).toBeVisible();
  });

  it('seeds every non-click stem at 100% and click at 0%, applying both to the AudioManager', () => {
    const audioManager = makeAudioManager(['song', 'click']);
    renderMixer({audioManager});
    expect(lastVolume(audioManager, 'song')).toBe(1);
    expect(lastVolume(audioManager, 'click')).toBe(0);
  });

  it('a slider change drives the AudioManager volume', () => {
    const audioManager = makeAudioManager(['song']);
    renderMixer({audioManager});
    const slider = rowSlider('song');
    slider.focus();
    // A mid-range value, not 0: a step down from the 100% default reaches a
    // volume no other control (mute, solo-silencing) can produce.
    fireEvent.keyDown(slider, {key: 'ArrowLeft'});
    expect(lastVolume(audioManager, 'song')).toBeCloseTo(0.99);
    expect(within(screen.getByTestId('stem-row-song')).getByText('99%'));
  });

  it('double-clicking a slider resets it to its default', () => {
    const audioManager = makeAudioManager(['song']);
    renderMixer({audioManager});
    const slider = rowSlider('song');
    slider.focus();
    fireEvent.keyDown(slider, {key: 'Home'});
    expect(lastVolume(audioManager, 'song')).toBe(0);
    fireEvent.doubleClick(slider);
    expect(lastVolume(audioManager, 'song')).toBe(1);
  });

  it('mute silences a stem without affecting others', () => {
    const audioManager = makeAudioManager(['song', 'drums']);
    renderMixer({audioManager});
    fireEvent.click(screen.getByRole('button', {name: 'Mute Song'}));
    expect(lastVolume(audioManager, 'song')).toBe(0);
    expect(lastVolume(audioManager, 'drums')).toBe(1);
  });

  it('solo dims every other stem and restores when un-solo’d', () => {
    const audioManager = makeAudioManager(['song', 'drums']);
    renderMixer({audioManager});
    fireEvent.click(screen.getByRole('button', {name: 'Solo Drums'}));
    expect(lastVolume(audioManager, 'song')).toBe(0);
    expect(lastVolume(audioManager, 'drums')).toBe(1);
    fireEvent.click(screen.getByRole('button', {name: 'Unsolo Drums'}));
    expect(lastVolume(audioManager, 'song')).toBe(1);
  });

  it('supports multiple simultaneous solos', () => {
    const audioManager = makeAudioManager(['song', 'drums', 'vocals']);
    renderMixer({audioManager});
    fireEvent.click(screen.getByRole('button', {name: 'Solo Drums'}));
    fireEvent.click(screen.getByRole('button', {name: 'Solo Vocals'}));
    expect(lastVolume(audioManager, 'song')).toBe(0);
    expect(lastVolume(audioManager, 'drums')).toBe(1);
    expect(lastVolume(audioManager, 'vocals')).toBe(1);
  });

  it('an explicit mute survives solo churn on other rows', () => {
    const audioManager = makeAudioManager(['song', 'drums']);
    renderMixer({audioManager});
    fireEvent.click(screen.getByRole('button', {name: 'Mute Song'}));
    expect(lastVolume(audioManager, 'song')).toBe(0);
    fireEvent.click(screen.getByRole('button', {name: 'Solo Drums'}));
    expect(lastVolume(audioManager, 'song')).toBe(0);
    fireEvent.click(screen.getByRole('button', {name: 'Unsolo Drums'}));
    expect(lastVolume(audioManager, 'song')).toBe(0);
  });

  it('badges only AI-separated stems', () => {
    const audioManager = makeAudioManager(['song', 'drums']);
    renderMixer({
      audioManager,
      stemOrigins: [{name: 'drums', origin: 'ai-separated'}],
    });
    expect(
      within(screen.getByTestId('stem-row-drums')).getByLabelText(
        'AI-separated stem',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('stem-row-song')).queryByLabelText(
        'AI-separated stem',
      ),
    ).not.toBeInTheDocument();
  });

  it('an AI-separated stem arrives muted, with a level to unmute to', () => {
    const audioManager = makeAudioManager(['song', 'drums']);
    renderMixer({
      audioManager,
      stemOrigins: [{name: 'drums', origin: 'ai-separated'}],
    });

    // Silent, and the row says why: the M toggle is lit, not a slider
    // parked at zero.
    expect(lastVolume(audioManager, 'drums')).toBe(0);
    const row = screen.getByTestId('stem-row-drums');
    expect(
      within(row).getByRole('button', {name: 'Unmute Drums'}),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(within(row).getByText('100%')).toBeInTheDocument();
    expect(lastVolume(audioManager, 'song')).toBe(1);

    // One click is all it takes to hear it, and it comes back at full level.
    fireEvent.click(within(row).getByRole('button', {name: 'Unmute Drums'}));
    expect(lastVolume(audioManager, 'drums')).toBe(1);
  });

  it('leaves a stem the user dropped in themselves audible', () => {
    const audioManager = makeAudioManager(['song', 'keys']);
    renderMixer({
      audioManager,
      stemOrigins: [{name: 'keys', origin: 'user-added'}],
    });
    expect(lastVolume(audioManager, 'keys')).toBe(1);
    expect(
      within(screen.getByTestId('stem-row-keys')).getByRole('button', {
        name: 'Mute Keys',
      }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('the click row has no Solo button and is solo-exempt', () => {
    const audioManager = makeAudioManager(['song', 'click']);
    renderMixer({audioManager});
    const clickSlider = rowSlider('click');
    clickSlider.focus();
    fireEvent.keyDown(clickSlider, {key: 'End'});
    expect(lastVolume(audioManager, 'click')).toBe(1);

    fireEvent.click(screen.getByRole('button', {name: 'Solo Song'}));
    // Click stays audible even though something else is solo'd.
    expect(lastVolume(audioManager, 'click')).toBe(1);
    expect(
      within(screen.getByTestId('stem-row-click')).queryByRole('button', {
        name: /solo/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('locks a row’s controls without affecting other rows', () => {
    const audioManager = makeAudioManager(['song', 'drums']);
    renderMixer({audioManager, lockedTrackNames: new Set(['drums'])});
    // Radix's Slider Thumb isn't a native form control, so a locked slider
    // shows up as `data-disabled` rather than the `disabled` HTML attribute
    // `toBeDisabled()` looks for.
    expect(rowSlider('drums')).toHaveAttribute('data-disabled');
    expect(screen.getByRole('button', {name: 'Mute Drums'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Solo Drums'})).toBeDisabled();
    expect(rowSlider('song')).not.toHaveAttribute('data-disabled');
    expect(screen.getByRole('button', {name: 'Mute Song'})).toBeEnabled();
  });

  it('has no drop zone when the host provides no onAddStem', () => {
    const audioManager = makeAudioManager(['song']);
    renderMixer({audioManager});
    expect(
      screen.queryByLabelText('Drop an audio file to add a stem'),
    ).not.toBeInTheDocument();
  });

  it('drop-add decodes the file and wires a new row through the host', async () => {
    function Harness() {
      const [trackNames, setTrackNames] = useState(['song']);
      const audioManager = makeAudioManager(trackNames);
      return (
        <TooltipProvider>
          <StemsMixer
            audioManager={audioManager}
            onAddStem={({name}) => setTrackNames(prev => [...prev, name])}
          />
        </TooltipProvider>
      );
    }
    render(<Harness />);

    const dropZone = screen.getByLabelText('Drop an audio file to add a stem');
    const file = new File(['fake-audio-bytes'], 'keys.wav', {
      type: 'audio/wav',
    });
    await act(async () => {
      fireEvent.drop(dropZone, {dataTransfer: {files: [file]}});
      // Flush the async decode.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByTestId('stem-row-keys')).toBeVisible();
  });

  it('renders a solo-silenced row distinctly from an explicitly muted one', () => {
    const audioManager = makeAudioManager(['song', 'drums']);
    renderMixer({audioManager});
    fireEvent.click(screen.getByRole('button', {name: 'Solo Drums'}));

    // Song is silent because drums is solo'd — not because it is muted.
    const soloSilencedClassName = screen.getByTestId('stem-row-song').className;
    expect(lastVolume(audioManager, 'song')).toBe(0);
    expect(screen.getByTestId('stem-row-song')).toHaveAttribute(
      'title',
      "Silent because another stem is solo'd, not muted itself",
    );
    expect(screen.getByRole('button', {name: 'Mute Song'})).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // An explicit mute on the same row is a different rendering: it drops the
    // solo-silenced explanation and fills the row's own M toggle red (the
    // approved prototype puts the alarm on the toggle, not on the label —
    // both silent states render the label quietly).
    fireEvent.click(screen.getByRole('button', {name: 'Mute Song'}));
    const muted = screen.getByTestId('stem-row-song');
    expect(muted).not.toHaveAttribute('title');
    const muteToggle = within(muted).getByRole('button', {name: 'Unmute Song'});
    expect(muteToggle).toHaveAttribute('aria-pressed', 'true');
    expect(muteToggle.className).toContain('bg-red-600');
    expect(muted.className).not.toEqual(soloSilencedClassName);
  });

  it('keeps each row’s volume, mute, and solo across an AudioManager swap', () => {
    function Harness() {
      const [generation, setGeneration] = useState(0);
      // A fresh AudioManager instance per generation, same tracks — what a
      // padded-audio rebuild hands the mixer.
      const audioManager = useMemo(
        () => makeAudioManager(['song', 'drums', 'click']),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [generation],
      );
      managers[generation] = audioManager;
      return (
        <TooltipProvider>
          <button type="button" onClick={() => setGeneration(g => g + 1)}>
            Rebuild
          </button>
          <StemsMixer audioManager={audioManager} />
        </TooltipProvider>
      );
    }
    const managers: AudioManager[] = [];
    render(<Harness />);

    const clickSlider = rowSlider('click');
    clickSlider.focus();
    fireEvent.keyDown(clickSlider, {key: 'ArrowRight'});
    fireEvent.click(screen.getByRole('button', {name: 'Mute Song'}));
    fireEvent.click(screen.getByRole('button', {name: 'Solo Drums'}));

    fireEvent.click(screen.getByRole('button', {name: 'Rebuild'}));

    // The new manager gets the same resolved volumes: song muted, drums
    // solo'd and audible, click at the raised (solo-exempt) level.
    const rebuilt = managers[1];
    expect(rebuilt).not.toBe(managers[0]);
    expect(lastVolume(rebuilt, 'song')).toBe(0);
    expect(lastVolume(rebuilt, 'drums')).toBe(1);
    expect(lastVolume(rebuilt, 'click')).toBeCloseTo(0.01);
    // ...and the controls still read that way.
    expect(screen.getByRole('button', {name: 'Unmute Song'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Unsolo Drums'})).toBeVisible();
  });

  // "M" and "S" say nothing on their own, so each toggle spells its word out
  // on hover. Radix renders the tooltip content into a portal keyed to the
  // trigger, so the assertion is on the document, not inside the row.
  it('spells out "Mute" and "Solo" in a tooltip on the M/S toggles', async () => {
    const audioManager = makeAudioManager(['song', 'drums', 'click']);
    renderMixer({audioManager});

    fireEvent.focus(screen.getByRole('button', {name: 'Mute Drums'}));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Mute$/);

    fireEvent.blur(screen.getByRole('button', {name: 'Mute Drums'}));
    fireEvent.focus(screen.getByRole('button', {name: 'Solo Drums'}));
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(/^Solo$/),
    );
  });
});

/**
 * Drop-to-add naming. `AudioManager` decides a dropped stem's track name
 * (basename, with any `drums`-containing file folded into one `drums`
 * track), so the name the mixer hands the host has to be one that comes back
 * as its own row — otherwise the stem plays with no visible control.
 */
describe('StemsMixer drop-to-add naming', () => {
  /** Drops `fileName` on the mixer and returns every name handed to
   *  `onAddStem`. `trackNames` stays fixed, standing in for the seconds
   *  before the host's rebuild swaps in a new AudioManager. */
  async function dropFiles(
    trackNames: string[],
    fileNames: string[],
  ): Promise<string[]> {
    const added: string[] = [];
    const audioManager = makeAudioManager(trackNames);
    renderMixer({
      audioManager,
      onAddStem: ({name}) => {
        added.push(name);
      },
    });
    const dropZone = screen.getByLabelText('Drop an audio file to add a stem');
    for (const fileName of fileNames) {
      const file = new File(['fake-audio-bytes'], fileName, {
        type: 'audio/wav',
      });
      await act(async () => {
        fireEvent.drop(dropZone, {dataTransfer: {files: [file]}});
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    return added;
  }

  it('suffixes a name that collides with an existing track', async () => {
    expect(await dropFiles(['song', 'keys'], ['keys.wav'])).toEqual(['keys 2']);
  });

  it('keeps two drops distinct while the host is still rebuilding', async () => {
    expect(await dropFiles(['song'], ['keys.wav', 'keys.wav'])).toEqual([
      'keys',
      'keys 2',
    ]);
  });

  it('never hands back a name AudioManager would fold into the drums track', async () => {
    const added = await dropFiles(
      ['song', 'drums'],
      ['drums.wav', 'eardrums.wav'],
    );
    for (const name of added) {
      expect(name).not.toContain('drums');
    }
    expect(new Set(added).size).toBe(added.length);
  });
});
