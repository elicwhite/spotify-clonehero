/**
 * @jest-environment jsdom
 */
/**
 * The Stems section on a chart that has no audio yet: what it invites the
 * user to do, and what a drop hands the host.
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';

import StemsMixer from '../StemsMixer';
import {TooltipProvider} from '@/components/ui/tooltip';
import {CLICK_TRACK_NAME} from '@/lib/preview/clickTrack';
import {fakeAudioManager} from '../../__tests__/fakeAudioManager';

jest.mock('../../../../lib/drum-transcription/audio/decoder', () => ({
  decodeAudio: jest.fn(async () => ({
    numberOfChannels: 2,
    length: 8,
    sampleRate: 44100,
    duration: 8 / 44100,
    getChannelData: () => new Float32Array(8),
  })),
  interleaveAudioBuffer: jest.fn(() => new Float32Array(16)),
}));

beforeAll(() => {
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function audioFile(name: string, bytes: number[]): File {
  const file = new File([new Uint8Array(bytes)], name, {type: 'audio/mpeg'});
  // jsdom's File has no arrayBuffer(); the mixer reads the dropped bytes
  // through it to hand them to the host.
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new Uint8Array(bytes).buffer,
  });
  return file;
}

describe('StemsMixer with no audio', () => {
  it('offers the drop target as the section body', () => {
    render(
      <TooltipProvider>
        <StemsMixer
          audioManager={fakeAudioManager({trackNames: [CLICK_TRACK_NAME]})}
          onAddStem={() => {}}
          emptyState
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByLabelText('Drop an audio file here to add it to this chart'),
    ).toBeInTheDocument();
    // The click row is still there above it, so the section is never empty.
    expect(screen.getByTestId(`stem-row-${CLICK_TRACK_NAME}`)).toBeVisible();
  });

  it('adds every dropped file, uniquely named, with its source bytes', async () => {
    const added: {name: string; file: {fileName: string; data: Uint8Array}}[] =
      [];
    render(
      <TooltipProvider>
        <StemsMixer
          audioManager={fakeAudioManager({trackNames: [CLICK_TRACK_NAME]})}
          onAddStem={input => {
            added.push(input);
          }}
          emptyState
        />
      </TooltipProvider>,
    );

    fireEvent.drop(
      screen.getByLabelText('Drop an audio file here to add it to this chart'),
      {
        dataTransfer: {
          files: [audioFile('take.mp3', [1, 2]), audioFile('take.mp3', [3, 4])],
        },
      },
    );

    await waitFor(() => expect(added).toHaveLength(2));
    expect(added.map(a => a.name)).toEqual(['take', 'take 2']);
    expect(added[0].file.fileName).toBe('take.mp3');
    expect(Array.from(added[0].file.data)).toEqual([1, 2]);
    expect(Array.from(added[1].file.data)).toEqual([3, 4]);
  });
});
