/**
 * @jest-environment jsdom
 */
/**
 * Capability-gate render tests.
 *
 * Mounts `LeftSidebar` under each capability preset and asserts which
 * sidebar sections render. Three.js renderer modules don't need to load
 * — the LeftSidebar reads only state + capabilities + audioManager.
 *
 * These tests cover the **render-time** gating contract that
 * `EditorCapabilities` is supposed to enforce. UI gating is the only
 * gate today — phase 8 will add a dispatch-path gate via
 * `EditorProfile.allowedOperations`, with separate tests at that point.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {TooltipProvider} from '@/components/ui/tooltip';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';
import LeftSidebar from '../LeftSidebar';
import type {ChartAssistProps} from '../sidebar/ChartAssist';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {
  ADD_LYRICS_CAPABILITIES,
  DRUM_EDIT_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  TEMPO_CAPABILITIES,
  type EditorCapabilities,
} from '../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE, DEFAULT_VOCALS_SCOPE} from '../scope';
import type {AudioManager} from '@/lib/preview/audioManager';

// jsdom has no ResizeObserver; Radix's Slider (one per Stems mixer row)
// needs one.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

/** Minimal AudioManager stub. LeftSidebar calls `setTempo`, the A/B loop
 *  controls read `currentTime`/`setPracticeMode`, and the Stems mixer (plan
 *  0074 Phase 5) reads `trackNames`/`setVolume`. The mixer renders one row
 *  per track name, and nothing at all for an empty list, so cases about the
 *  mixer pass track names explicitly. */
function stubAudioManager(trackNames: string[] = []): AudioManager {
  return {
    setTempo: () => {},
    trackNames,
    setVolume: () => {},
    currentTime: 12,
    setPracticeMode: () => {},
  } as unknown as AudioManager;
}

function renderWith(
  capabilities: EditorCapabilities,
  scope = DEFAULT_DRUMS_EXPERT_SCOPE,
) {
  return render(
    <ChartEditorProvider capabilities={capabilities} activeScope={scope}>
      <LeftSidebar audioManager={stubAudioManager()} />
    </ChartEditorProvider>,
  );
}

/** Sidebar with real audio tracks, for the Stems mixer cases. */
function renderWithTracks(
  capabilities: EditorCapabilities,
  trackNames: string[],
  stemsMixer?: React.ComponentProps<typeof LeftSidebar>['stemsMixer'],
  scope = DEFAULT_DRUMS_EXPERT_SCOPE,
) {
  return render(
    <TooltipProvider>
      <ChartEditorProvider capabilities={capabilities} activeScope={scope}>
        <LeftSidebar
          audioManager={stubAudioManager(trackNames)}
          stemsMixer={stemsMixer}
        />
      </ChartEditorProvider>
    </TooltipProvider>,
  );
}

/** Wiring a fully project-backed host (the `/drum-transcription` editor)
 *  supplies: every Chart Assist card has what its action needs. */
const FULL_WIRING: ChartAssistProps = {
  projectId: 'proj-1',
  loadAudio: async () => ({
    loadOriginalBytes: async () => new Uint8Array(4),
  }),
  audioSampleRate: 44100,
};

function makeDoc(): ChartDocument {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 480});
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart, assets: []};
}

function SidebarWithDoc({
  wiring,
  trackNames = [],
}: {
  wiring: ChartAssistProps;
  trackNames?: string[];
}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: makeDoc()});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <LeftSidebar
      audioManager={stubAudioManager(trackNames)}
      chartAssist={wiring}
    />
  );
}

/** Renders the sidebar with a loaded chart, an assist runner, and whatever
 *  Chart Assist wiring the case is about. */
function renderAssist(
  capabilities: EditorCapabilities,
  wiring: ChartAssistProps,
  scope = DEFAULT_DRUMS_EXPERT_SCOPE,
  trackNames: string[] = [],
) {
  return render(
    <TooltipProvider>
      <AssistRunnerProvider>
        <ChartEditorProvider capabilities={capabilities} activeScope={scope}>
          <SidebarWithDoc wiring={wiring} trackNames={trackNames} />
        </ChartEditorProvider>
      </AssistRunnerProvider>
    </TooltipProvider>,
  );
}

/**
 * Buttons rendered by the utility cluster's tool row (plan 0074 Phase 7:
 * cursor + add-note — see `UtilityCluster.tsx`'s file header for why
 * bpm/timesig/erase/section don't have sidebar buttons anymore: bpm/timesig
 * are reachable from the piano roll's tempo-lane context menu, erase from
 * Delete/Backspace + the note context menu, and section (plan 0076 item 19)
 * from the section strip's own right-click menu). Querying for these
 * directly pins the gate to the actual interactive controls — a bug that
 * hides the section header but keeps the buttons would still fail this
 * test.
 */
const TOOL_BUTTON_NAMES = [/cursor/i, /place note/i] as const;

describe('LeftSidebar capability gating', () => {
  describe('DRUM_EDIT_CAPABILITIES', () => {
    beforeEach(() => {
      renderWith(DRUM_EDIT_CAPABILITIES);
    });

    it('renders every tool-row button', () => {
      for (const name of TOOL_BUTTON_NAMES) {
        expect(screen.getByRole('button', {name})).toBeInTheDocument();
      }
    });
  });

  describe('ADD_LYRICS_CAPABILITIES', () => {
    beforeEach(() => {
      renderWith(ADD_LYRICS_CAPABILITIES, DEFAULT_VOCALS_SCOPE);
    });

    it('hides every tool-row button', () => {
      for (const name of TOOL_BUTTON_NAMES) {
        expect(screen.queryByRole('button', {name})).not.toBeInTheDocument();
      }
    });

    it('hides the NoteInspector (notes are not selectable)', () => {
      // The inspector renders a "Selected" or "Inspector" header. With no
      // notes selectable, the gate (`capabilities.selectable.has('note')`)
      // skips the whole component.
      expect(screen.queryByText(/Selected/i)).not.toBeInTheDocument();
    });
  });
});

/**
 * Chart Assist section gating (plan 0074 Phase 2, task 2e). Two independent
 * dimensions decide whether a card renders: the capability preset's
 * `chartAssist` variant, and whether the host page supplied the wiring that
 * card's action needs. Both are exercised here.
 */
describe('Chart Matrix mounted in LeftSidebar (plan 0074 Phase 3)', () => {
  it('renders Chart Matrix above Chart Assist', () => {
    renderAssist(DRUM_EDIT_CAPABILITIES, FULL_WIRING);
    const matrixHeading = screen.getByText('Chart Matrix');
    const assistHeading = screen.getByText('Chart Assist');
    expect(
      matrixHeading.compareDocumentPosition(assistHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('hides Chart Matrix under PREVIEW_CAPABILITIES (showChartMatrix: false)', () => {
    renderAssist(PREVIEW_CAPABILITIES, FULL_WIRING);
    expect(screen.queryByText('Chart Matrix')).not.toBeInTheDocument();
  });
});

describe('Chart Assist section gating', () => {
  it('shows the section with the full card set under DRUM_EDIT_CAPABILITIES', () => {
    renderAssist(DRUM_EDIT_CAPABILITIES, FULL_WIRING);
    expect(screen.getByText('Chart Assist')).toBeInTheDocument();
    for (const name of [
      'Tempo map',
      'Sections',
      'Add leading silence',
      'Drum transcription',
      'Lyrics',
    ]) {
      expect(screen.getByRole('group', {name})).toBeInTheDocument();
    }
  });

  it('shows only the Lyrics card under ADD_LYRICS_CAPABILITIES', () => {
    renderAssist(ADD_LYRICS_CAPABILITIES, FULL_WIRING, DEFAULT_VOCALS_SCOPE);
    expect(screen.getByText('Chart Assist')).toBeInTheDocument();
    expect(screen.getByRole('group', {name: 'Lyrics'})).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Tempo map'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Sections'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Add leading silence'}),
    ).not.toBeInTheDocument();
  });

  it('shows Tempo map + Sections + Add leading silence under TEMPO_CAPABILITIES', () => {
    renderAssist(TEMPO_CAPABILITIES, FULL_WIRING);
    expect(screen.getByRole('group', {name: 'Tempo map'})).toBeInTheDocument();
    expect(screen.getByRole('group', {name: 'Sections'})).toBeInTheDocument();
    expect(
      screen.getByRole('group', {name: 'Add leading silence'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Lyrics'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Drum transcription'}),
    ).not.toBeInTheDocument();
  });

  it('hides the section entirely under PREVIEW_CAPABILITIES', () => {
    renderAssist(PREVIEW_CAPABILITIES, FULL_WIRING);
    expect(screen.queryByText('Chart Assist')).not.toBeInTheDocument();
  });

  it('hides the whole section when the host wired nothing', () => {
    renderAssist(DRUM_EDIT_CAPABILITIES, {});
    expect(screen.queryByText('Chart Assist')).not.toBeInTheDocument();
  });

  it('renders only the cards whose wiring the host supplied', () => {
    // The `/tempo` shape: audio sample rate, no project, no audio loader.
    renderAssist(DRUM_EDIT_CAPABILITIES, {audioSampleRate: 44100});
    expect(
      screen.getByRole('group', {name: 'Add leading silence'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Tempo map'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Lyrics'}),
    ).not.toBeInTheDocument();
  });

  it('withholds the Drum transcription card when re-running is not allowed', () => {
    renderAssist(DRUM_EDIT_CAPABILITIES, {
      ...FULL_WIRING,
      allowDrumRerun: false,
    });
    expect(
      screen.queryByRole('group', {name: 'Drum transcription'}),
    ).not.toBeInTheDocument();
    // Its sibling cards are unaffected.
    expect(screen.getByRole('group', {name: 'Lyrics'})).toBeInTheDocument();
  });
});

describe('EditorCapabilities preset shape', () => {
  it('DRUM_EDIT exposes notes + sections + lyrics (plan 0063 Part D)', () => {
    expect(DRUM_EDIT_CAPABILITIES.selectable.has('note')).toBe(true);
    expect(DRUM_EDIT_CAPABILITIES.selectable.has('section')).toBe(true);
    // The editor's Add Lyrics flow (plan 0063 Part C) writes into the same
    // vocalTracks the piano-roll lyrics row and the highway marker drag both
    // read/write, so lyrics are interactive here too, not just on
    // /add-lyrics.
    expect(DRUM_EDIT_CAPABILITIES.selectable.has('lyric')).toBe(true);
    expect(DRUM_EDIT_CAPABILITIES.draggable.has('lyric')).toBe(true);
    expect(DRUM_EDIT_CAPABILITIES.showDrumLanes).toBe(true);
    expect(DRUM_EDIT_CAPABILITIES.showNotePlacementTools).toBe(true);
  });

  it('ADD_LYRICS exposes lyric/phrase markers, not notes', () => {
    expect(ADD_LYRICS_CAPABILITIES.selectable.has('note')).toBe(false);
    expect(ADD_LYRICS_CAPABILITIES.selectable.has('lyric')).toBe(true);
    expect(ADD_LYRICS_CAPABILITIES.selectable.has('phrase-start')).toBe(true);
    expect(ADD_LYRICS_CAPABILITIES.selectable.has('phrase-end')).toBe(true);
    expect(ADD_LYRICS_CAPABILITIES.showDrumLanes).toBe(false);
    expect(ADD_LYRICS_CAPABILITIES.showNotePlacementTools).toBe(false);
  });

  it('hides the vocal-part picker on ADD_LYRICS (aligner only writes vocals)', () => {
    expect(DRUM_EDIT_CAPABILITIES.showVocalPartPicker).toBe(true);
    expect(ADD_LYRICS_CAPABILITIES.showVocalPartPicker).toBe(false);
  });

  it('every draggable kind is selectable (drag implies select)', () => {
    for (const preset of [DRUM_EDIT_CAPABILITIES, ADD_LYRICS_CAPABILITIES]) {
      for (const kind of preset.draggable) {
        expect(preset.selectable.has(kind)).toBe(true);
      }
    }
  });

  it('gates showChartMatrix: on for DRUM_EDIT, off for PREVIEW/TEMPO/ADD_LYRICS (plan 0074 Phase 3)', () => {
    expect(DRUM_EDIT_CAPABILITIES.showChartMatrix).toBe(true);
    expect(PREVIEW_CAPABILITIES.showChartMatrix).toBe(false);
    expect(TEMPO_CAPABILITIES.showChartMatrix).toBe(false);
    expect(ADD_LYRICS_CAPABILITIES.showChartMatrix).toBe(false);
  });
});

/**
 * Stems mixer gating + lock behavior (plan 0074 Phase 5, Suite 6/8). The
 * mixer renders nothing for an empty track list, so every case here supplies
 * real track names — otherwise `showStemsMixer: true` and `false` would look
 * identical.
 */
describe('Stems mixer gating', () => {
  it('shows the mixer under DRUM_EDIT_CAPABILITIES', () => {
    renderWithTracks(DRUM_EDIT_CAPABILITIES, ['song', 'drums', 'click']);
    expect(screen.getByText('Stems')).toBeInTheDocument();
    expect(screen.getByTestId('stem-row-drums')).toBeInTheDocument();
  });

  it('shows the mixer under TEMPO_CAPABILITIES', () => {
    renderWithTracks(TEMPO_CAPABILITIES, ['song', 'drums', 'click']);
    expect(screen.getByTestId('stem-row-song')).toBeInTheDocument();
  });

  it('hides the mixer under PREVIEW_CAPABILITIES even with tracks loaded', () => {
    renderWithTracks(PREVIEW_CAPABILITIES, ['song', 'drums', 'click']);
    expect(screen.queryByTestId('stem-row-song')).not.toBeInTheDocument();
  });

  it('hides the mixer under ADD_LYRICS_CAPABILITIES even with tracks loaded', () => {
    renderWithTracks(
      ADD_LYRICS_CAPABILITIES,
      ['song', 'vocals', 'click'],
      undefined,
      DEFAULT_VOCALS_SCOPE,
    );
    expect(screen.queryByTestId('stem-row-vocals')).not.toBeInTheDocument();
  });

  it('keeps the A/B loop usable while an assist run locks a stem row', () => {
    renderWithTracks(DRUM_EDIT_CAPABILITIES, ['song', 'drums', 'click'], {
      lockedTrackNames: new Set(['drums']),
    });

    // The locked row's own controls are inert...
    expect(screen.getByRole('button', {name: 'Mute Drums'})).toBeDisabled();
    expect(
      within(screen.getByTestId('stem-row-drums')).getByRole('slider'),
    ).toHaveAttribute('data-disabled');

    // ...while the transport-adjacent A/B loop still takes input: setting A
    // turns the loop on, which reveals the clear-loop control. Plan 0076
    // item 21 renamed the bare "A"/"B" labels to accessible names that state
    // the interaction.
    const setA = screen.getByRole('button', {
      name: 'Set loop start at playhead',
    });
    expect(setA).toBeEnabled();
    fireEvent.click(setA);
    expect(
      screen.getByRole('button', {name: 'Set loop end at playhead'}),
    ).toBeEnabled();
    expect(screen.getByText(/0:12/)).toBeInTheDocument();
  });
});

/**
 * Sidebar section order (plan 0074 Phase 7): Chart Matrix -> Chart Assist ->
 * Stems -> the "Snap · Speed · Loop" utility cluster, matching the approved
 * prototype (`loading-inline.html`). Asserted by accessible heading name/
 * order rather than DOM class or testid, so a change that reorders sections
 * but keeps their markup would still fail this test.
 */
describe('Sidebar section order (plan 0074 Phase 7)', () => {
  it('renders Chart Matrix, Chart Assist, Stems, then the utility cluster in that order', () => {
    renderAssist(
      DRUM_EDIT_CAPABILITIES,
      FULL_WIRING,
      DEFAULT_DRUMS_EXPERT_SCOPE,
      ['song', 'drums', 'click'],
    );

    const headingNames = screen
      .getAllByRole('heading', {level: 3})
      .map(h => h.textContent);

    expect(headingNames).toEqual([
      'Chart Matrix',
      'Chart Assist',
      'Stems',
      'Snap · Speed · Loop',
    ]);
  });
});
