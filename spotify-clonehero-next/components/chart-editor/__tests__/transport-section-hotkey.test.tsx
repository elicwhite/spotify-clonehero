/**
 * @jest-environment jsdom
 */
/**
 * Regression test for plan 0077 item 5.
 *
 * TransportControls' skip-forward/skip-back buttons jump by section and
 * advertise Mod+ArrowRight / Mod+ArrowLeft in their tooltips. The hotkeys
 * must actually jump by section too (not by measure) and land on exactly
 * the same target the buttons compute.
 */

import '@testing-library/jest-dom';
import {fireEvent, render} from '@testing-library/react';
import TransportControls from '../TransportControls';
import {ChartEditorProvider} from '../ChartEditorContext';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import type {AudioManager} from '@/lib/preview/audioManager';

type Section = {name: string; msTime: number};

function renderTransport(props: {
  audioManager: AudioManager;
  durationSeconds: number;
  sections: Section[];
}) {
  return render(
    <ChartEditorProvider activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
      <TransportControls {...props} />
    </ChartEditorProvider>,
  );
}

function stubAudioManager(chartTimeSec: number) {
  const playChartTime = jest.fn();
  const audioManager = {
    isInitialized: true,
    isPlaying: false,
    chartTime: chartTimeSec,
    currentTime: chartTimeSec,
    playChartTime,
    pause: jest.fn(),
    resume: jest.fn(),
    play: jest.fn(),
  } as unknown as AudioManager;
  return {audioManager, playChartTime};
}

const sections = [
  {name: 'Intro', msTime: 0},
  {name: 'Verse', msTime: 5000},
  {name: 'Chorus', msTime: 10000},
  {name: 'Outro', msTime: 15000},
];

describe('TransportControls — Mod+ArrowLeft/Right section hotkey (plan 0077 item 5)', () => {
  it('Mod+ArrowRight hotkey jumps to the same section the skip-forward button targets', () => {
    const {audioManager, playChartTime} = stubAudioManager(
      2 /* seconds, in Intro */,
    );
    renderTransport({audioManager, durationSeconds: 20, sections});

    fireEvent.keyDown(document, {key: 'ArrowRight', ctrlKey: true});

    expect(playChartTime).toHaveBeenCalledTimes(1);
    expect(playChartTime).toHaveBeenCalledWith(5); // Verse, in seconds
  });

  it('Mod+ArrowLeft hotkey jumps to the same section the skip-back button targets', () => {
    const {audioManager, playChartTime} = stubAudioManager(
      11 /* seconds, in Chorus */,
    );
    renderTransport({audioManager, durationSeconds: 20, sections});

    fireEvent.keyDown(document, {key: 'ArrowLeft', ctrlKey: true});

    expect(playChartTime).toHaveBeenCalledTimes(1);
    expect(playChartTime).toHaveBeenCalledWith(10); // Chorus start, in seconds
  });

  it('button click and hotkey compute the identical target for the same position', () => {
    const start = stubAudioManager(11);
    const rendered = renderTransport({
      audioManager: start.audioManager,
      durationSeconds: 20,
      sections,
    });
    // First button in the transport is skip-back (previous section).
    fireEvent.click(rendered.getAllByRole('button')[0]);
    rendered.unmount();

    const viaHotkey = stubAudioManager(11);
    renderTransport({
      audioManager: viaHotkey.audioManager,
      durationSeconds: 20,
      sections,
    });
    fireEvent.keyDown(document, {key: 'ArrowLeft', ctrlKey: true});

    expect(viaHotkey.playChartTime).toHaveBeenCalledWith(
      start.playChartTime.mock.calls[0][0],
    );
  });
});
