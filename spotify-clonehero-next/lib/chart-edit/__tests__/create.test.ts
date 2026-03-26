import { createChart, writeChart } from '../index';
import type { ChartDocument, FileEntry } from '../types';
import { parseChartFile } from '@eliwhite/scan-chart';

describe('createChart', () => {
  describe('defaults', () => {
    let doc: ChartDocument;

    beforeAll(() => {
      doc = createChart();
    });

    it('uses resolution 480', () => {
      expect(doc.chartTicksPerBeat).toBe(480);
    });

    it('defaults to mid format', () => {
      expect(doc.originalFormat).toBe('mid');
    });

    it('has one tempo at tick 0 with 120 BPM', () => {
      expect(doc.tempos).toHaveLength(1);
      expect(doc.tempos[0].tick).toBe(0);
      expect(doc.tempos[0].beatsPerMinute).toBe(120);
    });

    it('has one time signature 4/4 at tick 0', () => {
      expect(doc.timeSignatures).toHaveLength(1);
      expect(doc.timeSignatures[0].tick).toBe(0);
      expect(doc.timeSignatures[0].numerator).toBe(4);
      expect(doc.timeSignatures[0].denominator).toBe(4);
    });

    it('has empty trackData', () => {
      expect(doc.trackData).toEqual([]);
    });

    it('has empty sections', () => {
      expect(doc.sections).toEqual([]);
    });

    it('has empty lyrics', () => {
      expect(doc.lyrics).toEqual([]);
    });

    it('has empty endEvents', () => {
      expect(doc.endEvents).toEqual([]);
    });

    it('has empty vocalPhrases', () => {
      expect(doc.vocalPhrases).toEqual([]);
    });

    it('has empty assets', () => {
      expect(doc.assets).toEqual([]);
    });

    it('has empty metadata', () => {
      expect(doc.metadata).toEqual({});
    });

    it('has hasLyrics false', () => {
      expect(doc.hasLyrics).toBe(false);
    });

    it('has hasVocals false', () => {
      expect(doc.hasVocals).toBe(false);
    });
  });

  describe('custom options', () => {
    it('accepts custom resolution', () => {
      const doc = createChart({ resolution: 192 });
      expect(doc.chartTicksPerBeat).toBe(192);
    });

    it('accepts custom BPM', () => {
      const doc = createChart({ bpm: 140 });
      expect(doc.tempos[0].beatsPerMinute).toBe(140);
    });

    it('accepts custom time signature', () => {
      const doc = createChart({
        timeSignature: { numerator: 3, denominator: 4 },
      });
      expect(doc.timeSignatures[0].numerator).toBe(3);
      expect(doc.timeSignatures[0].denominator).toBe(4);
    });

    it('accepts chart format', () => {
      const doc = createChart({ format: 'chart' });
      expect(doc.originalFormat).toBe('chart');
    });

    it('accepts all custom options together', () => {
      const doc = createChart({
        resolution: 192,
        bpm: 140,
        timeSignature: { numerator: 3, denominator: 4 },
        format: 'chart',
      });
      expect(doc.chartTicksPerBeat).toBe(192);
      expect(doc.tempos[0].beatsPerMinute).toBe(140);
      expect(doc.timeSignatures[0].numerator).toBe(3);
      expect(doc.timeSignatures[0].denominator).toBe(4);
      expect(doc.originalFormat).toBe('chart');
    });
  });

  describe('createChart -> writeChart round-trip', () => {
    it('produces notes.mid and song.ini for default (mid) format', () => {
      const doc = createChart();
      const files = writeChart(doc);
      const fileNames = files.map((f) => f.fileName);

      expect(fileNames).toContain('notes.mid');
      expect(fileNames).toContain('song.ini');
    });

    it('produces notes.chart and song.ini for chart format', () => {
      const doc = createChart({ format: 'chart' });
      const files = writeChart(doc);
      const fileNames = files.map((f) => f.fileName);

      expect(fileNames).toContain('notes.chart');
      expect(fileNames).toContain('song.ini');
    });

    it('produces non-empty chart file', () => {
      const doc = createChart();
      const files = writeChart(doc);
      const midFile = files.find((f) => f.fileName === 'notes.mid');
      expect(midFile).toBeDefined();
      expect(midFile!.data.length).toBeGreaterThan(0);
    });
  });

  describe('createChart -> writeChart -> parseChartFile', () => {
    it('round-trips a chart-format document through parseChartFile', () => {
      const doc = createChart({
        format: 'chart',
        resolution: 192,
        bpm: 140,
        timeSignature: { numerator: 3, denominator: 4 },
      });
      const files = writeChart(doc);
      const chartFile = files.find((f) => f.fileName === 'notes.chart')!;

      const parsed = parseChartFile(chartFile.data, 'chart');

      expect(parsed.resolution).toBe(192);
      expect(parsed.tempos).toHaveLength(1);
      expect(parsed.tempos[0].tick).toBe(0);
      expect(parsed.tempos[0].beatsPerMinute).toBeCloseTo(140, 3);
      expect(parsed.timeSignatures).toHaveLength(1);
      expect(parsed.timeSignatures[0].tick).toBe(0);
      expect(parsed.timeSignatures[0].numerator).toBe(3);
      expect(parsed.timeSignatures[0].denominator).toBe(4);
      expect(parsed.trackData).toHaveLength(0);
      expect(parsed.sections).toHaveLength(0);
    });

    it('round-trips a mid-format document through parseChartFile', () => {
      const doc = createChart({
        format: 'mid',
        resolution: 480,
        bpm: 120,
      });
      const files = writeChart(doc);
      const midFile = files.find((f) => f.fileName === 'notes.mid')!;

      const parsed = parseChartFile(midFile.data, 'mid');

      expect(parsed.resolution).toBe(480);
      expect(parsed.tempos).toHaveLength(1);
      expect(parsed.tempos[0].tick).toBe(0);
      expect(parsed.tempos[0].beatsPerMinute).toBeCloseTo(120, 2);
      expect(parsed.trackData).toHaveLength(0);
    });
  });
});
