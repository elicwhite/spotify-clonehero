/**
 * Single-instrument chart-edit pages (plan 0074 Phase 3, task 3c).
 *
 * `TrackScopePicker`/`DifficultyPicker` are retired: instrument/difficulty
 * switching is now the Chart Matrix (`ChartMatrix.tsx`, covered generically
 * in `chart-matrix.test.tsx`), pinned to one instrument via
 * `capabilities.showChartMatrix`. This suite is the wiring check that each
 * page's `TrackEditPageConfig` actually pins the matrix (and only the
 * matrix — nothing else in `DRUM_EDIT_CAPABILITIES` changes) to its own
 * instrument, so `TrackEditPage` forwards the right capability profile to
 * `ChartEditorProvider` instead of silently defaulting to the multi-
 * instrument `'all'` variant.
 */

import {DRUM_EDIT_CAPABILITIES} from '../capabilities';
import {CONFIG as GUITAR_EDIT_CONFIG} from '@/app/guitar-edit/GuitarEditClient';
import {CONFIG as BASS_EDIT_CONFIG} from '@/app/bass-edit/BassEditClient';
import {CONFIG as DRUM_EDIT_CONFIG} from '@/app/drum-edit/DrumEditClient';
import {CONFIG as CHART_EDITOR_CONFIG} from '@/app/chart-editor/ChartEditorClient';

describe('single-instrument page capability wiring', () => {
  it.each([
    ['guitar-edit', GUITAR_EDIT_CONFIG, 'guitar'],
    ['bass-edit', BASS_EDIT_CONFIG, 'bass'],
    ['drum-edit', DRUM_EDIT_CONFIG, 'drums'],
  ] as const)('%s pins the Chart Matrix to %s', (_name, config, instrument) => {
    expect(config.capabilities?.showChartMatrix).toBe(instrument);
    // Everything else stays identical to the full-editing preset — pinning
    // the matrix is the only behavior change these pages make.
    expect(config.capabilities).toEqual({
      ...DRUM_EDIT_CAPABILITIES,
      showChartMatrix: instrument,
    });
  });

  it('no longer wires a DifficultyPicker as headerExtra', () => {
    expect(GUITAR_EDIT_CONFIG.headerExtra).toBeUndefined();
    expect(BASS_EDIT_CONFIG.headerExtra).toBeUndefined();
  });

  it('the unified /chart-editor page keeps the multi-instrument matrix and drops TrackScopePicker', () => {
    // Capabilities omitted entirely -> TrackEditPage/ChartEditorProvider
    // fall back to DRUM_EDIT_CAPABILITIES (showChartMatrix: 'all').
    expect(CHART_EDITOR_CONFIG.capabilities).toBeUndefined();
    expect(CHART_EDITOR_CONFIG.leftPanelChildren).toBeUndefined();
  });
});
