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
import {render, screen} from '@testing-library/react';
import LeftSidebar from '../LeftSidebar';
import {ChartEditorProvider} from '../ChartEditorContext';
import {
  ADD_LYRICS_CAPABILITIES,
  DRUM_EDIT_CAPABILITIES,
  type EditorCapabilities,
} from '../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE, DEFAULT_VOCALS_SCOPE} from '../scope';
import type {AudioManager} from '@/lib/preview/audioManager';

/** Minimal AudioManager stub. LeftSidebar only calls `setTempo`; the rest
 *  of the surface is unreachable through the rendered controls in tests
 *  that don't simulate clicks. */
function stubAudioManager(): AudioManager {
  return {
    setTempo: () => {},
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

/**
 * Buttons rendered by the Tools palette. Querying for these directly
 * pins the gate to the actual interactive controls — a bug that hides
 * the section header but keeps the buttons would still fail this test.
 */
const TOOL_BUTTON_NAMES = [
  /cursor/i,
  /place note/i,
  /eraser/i,
  /bpm/i,
  /time sig/i,
  /section/i,
] as const;

describe('LeftSidebar capability gating', () => {
  describe('DRUM_EDIT_CAPABILITIES', () => {
    beforeEach(() => {
      renderWith(DRUM_EDIT_CAPABILITIES);
    });

    it('renders every Tools-palette button', () => {
      for (const name of TOOL_BUTTON_NAMES) {
        expect(screen.getByRole('button', {name})).toBeInTheDocument();
      }
    });

    it('shows the Highway-mode toggle', () => {
      expect(screen.getByText('Highway')).toBeInTheDocument();
    });
  });

  describe('ADD_LYRICS_CAPABILITIES', () => {
    beforeEach(() => {
      renderWith(ADD_LYRICS_CAPABILITIES, DEFAULT_VOCALS_SCOPE);
    });

    it('hides every Tools-palette button', () => {
      for (const name of TOOL_BUTTON_NAMES) {
        expect(screen.queryByRole('button', {name})).not.toBeInTheDocument();
      }
    });

    it('hides the Highway-mode toggle', () => {
      expect(screen.queryByText('Highway')).not.toBeInTheDocument();
    });

    it('hides the NoteInspector (notes are not selectable)', () => {
      // The inspector renders a "Selected" or "Inspector" header. With no
      // notes selectable, the gate (`capabilities.selectable.has('note')`)
      // skips the whole component.
      expect(screen.queryByText(/Selected/i)).not.toBeInTheDocument();
    });
  });
});

describe('EditorCapabilities preset shape', () => {
  it('DRUM_EDIT exposes notes + sections, not lyrics', () => {
    expect(DRUM_EDIT_CAPABILITIES.selectable.has('note')).toBe(true);
    expect(DRUM_EDIT_CAPABILITIES.selectable.has('section')).toBe(true);
    expect(DRUM_EDIT_CAPABILITIES.selectable.has('lyric')).toBe(false);
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

  it('every draggable kind is selectable (drag implies select)', () => {
    for (const preset of [DRUM_EDIT_CAPABILITIES, ADD_LYRICS_CAPABILITIES]) {
      for (const kind of preset.draggable) {
        expect(preset.selectable.has(kind)).toBe(true);
      }
    }
  });
});
