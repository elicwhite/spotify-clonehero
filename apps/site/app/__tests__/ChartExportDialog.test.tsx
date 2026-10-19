/**
 * @jest-environment jsdom
 */
/**
 * Reading one stored chart for export.
 *
 * Two layouts live in OPFS and only the namespace says which store can read a
 * project. Reading a transcription project through the chart-package store
 * answers "not found", so the dialog would never open and the page would look
 * like a button that does nothing.
 */

import {act, render, screen, waitFor} from '@testing-library/react';

import {ChartExportDialog} from '../storage/ChartExportDialog';
import type {StoredProject} from '../../lib/project-storage/storedProjects';

const exportDialog = jest.fn();
const chartPackageStore = jest.fn();
const transcriptionStore = {
  getProject: jest.fn(),
  findProjectChartFile: jest.fn(),
  readProjectBinary: jest.fn(),
  readSongOpus: jest.fn(),
};

jest.mock('next/dynamic', () => () => {
  const Mock = (props: unknown) => {
    exportDialog(props);
    return <div data-testid="dialog" />;
  };
  return Mock;
});

jest.mock('../../lib/project-storage/projects', () => ({
  chartPackageStore: () => chartPackageStore(),
}));

jest.mock('../../lib/drum-transcription/storage/opfs', () => ({
  getProject: (id: string) => transcriptionStore.getProject(id),
  findProjectChartFile: (id: string) =>
    transcriptionStore.findProjectChartFile(id),
  readProjectBinary: (id: string, name: string) =>
    transcriptionStore.readProjectBinary(id, name),
  readSongOpus: (id: string) => transcriptionStore.readSongOpus(id),
}));

const readChartForEditing = jest.fn((_files: unknown) => ({doc: 'chart'}));
const withSongIniFields = jest.fn((_doc: unknown, _ini: unknown) => ({
  doc: 'chart+ini',
}));

jest.mock('../../lib/chart-edit', () => ({
  readChartForEditing: (files: unknown) => readChartForEditing(files),
}));

jest.mock('../../lib/chart-editor-core', () => ({
  withSongIniFields: (doc: unknown, ini: unknown) =>
    withSongIniFields(doc, ini),
}));

const PROJECT: StoredProject = {
  id: 'a',
  namespace: 'chart-editor',
  name: 'Song One',
  artist: 'Band',
  sizeBytes: 1,
  updatedAt: null,
  stemFingerprint: null,
  isProject: true,
};

const noop = () => {};

beforeEach(() => {
  jest.clearAllMocks();
  chartPackageStore.mockReturnValue({
    getProject: async () => ({
      name: 'Song One',
      artist: 'Band',
      charter: 'Charter',
      origin: 'chart-editor',
      toolsApplied: ['add-lyrics'],
      chartFileFormat: 'chart',
    }),
    readChartFile: async () => ({
      fileName: 'notes.chart',
      data: new Uint8Array([1]),
    }),
    readSongIni: async () => new Uint8Array([2]),
    loadAudioFiles: async () => [],
    loadPassthroughAssets: async () => [],
  });
});

describe('ChartExportDialog', () => {
  it('passes the whole document, not just the chart file', async () => {
    render(
      <ChartExportDialog
        project={PROJECT}
        onClose={noop}
        onFailed={noop}
        onReady={noop}
      />,
    );

    await waitFor(() => expect(exportDialog).toHaveBeenCalled());
    // A chart file alone carries no song.ini surface, so album, year, genre
    // and the per-instrument intensities would be dropped from a copy taken
    // here — on the page that tells the user to copy before deleting.
    expect(withSongIniFields).toHaveBeenCalled();
    const props = exportDialog.mock.calls[0]![0];
    expect(props.chartDoc).toEqual({doc: 'chart+ini'});
    expect(props.showChartCheck).toBe(false);
    expect(props.sourceChartFormat).toBe('chart');
    // The export event reports what was applied; [] would under-count every
    // export taken from this page.
    expect(props.toolsApplied).toEqual(['add-lyrics']);
  });

  it('reads a transcription project through its own store', async () => {
    transcriptionStore.getProject.mockResolvedValue({
      name: 'Transcribed',
      artist: 'Band',
      charter: 'Charter',
    });
    transcriptionStore.findProjectChartFile.mockResolvedValue('notes.mid');
    transcriptionStore.readProjectBinary.mockResolvedValue(
      new Uint8Array([1]).buffer,
    );
    transcriptionStore.readSongOpus.mockResolvedValue(new ArrayBuffer(4));

    render(
      <ChartExportDialog
        project={{...PROJECT, namespace: 'drum-transcription'}}
        onClose={noop}
        onFailed={noop}
        onReady={noop}
      />,
    );

    await waitFor(() => expect(exportDialog).toHaveBeenCalled());
    expect(chartPackageStore).not.toHaveBeenCalled();
    const props = exportDialog.mock.calls[0]![0];
    expect(props.songName).toBe('Transcribed');
    // The stored format wins: converting a .mid to .chart drops vocal note
    // pitches, phrase lengths and harmony parts.
    expect(props.sourceChartFormat).toBe('mid');
  });

  it('says why when the chart cannot be read', async () => {
    const onFailed = jest.fn();
    chartPackageStore.mockReturnValue({
      getProject: async () => {
        throw new Error('Project "a" not found');
      },
      readChartFile: async () => {
        throw new Error('Project "a" not found');
      },
      readSongIni: async () => null,
    });

    render(
      <ChartExportDialog
        project={PROJECT}
        onClose={noop}
        onFailed={onFailed}
        onReady={noop}
      />,
    );

    // A dialog that never fills in looks like a button that did nothing.
    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(onFailed.mock.calls[0]![0]).toContain('Could not open Song One');
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('does not report to a caller that has gone away', async () => {
    const onReady = jest.fn();
    const {unmount} = render(
      <ChartExportDialog
        project={PROJECT}
        onClose={noop}
        onFailed={noop}
        onReady={onReady}
      />,
    );
    unmount();

    await act(async () => {});

    expect(onReady).not.toHaveBeenCalled();
  });
});
