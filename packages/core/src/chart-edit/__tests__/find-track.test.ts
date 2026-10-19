import type {ChartDocument} from '../types';
import {createEmptyChart} from '../index';
import {findTrack, findTrackOnly} from '../find-track';
import {emptyTrackData} from './test-utils';

function emptyDoc(): ChartDocument {
  return {
    parsedChart: createEmptyChart({bpm: 120, resolution: 480}),
    assets: [],
  };
}

describe('findTrack', () => {
  it('returns null when there are no tracks', () => {
    const doc = emptyDoc();
    expect(
      findTrack(doc, {instrument: 'drums', difficulty: 'expert'}),
    ).toBeNull();
  });

  it('returns null when only the instrument matches', () => {
    const doc = emptyDoc();
    doc.parsedChart.trackData.push(emptyTrackData('drums', 'hard'));
    expect(
      findTrack(doc, {instrument: 'drums', difficulty: 'expert'}),
    ).toBeNull();
  });

  it('returns null when only the difficulty matches', () => {
    const doc = emptyDoc();
    doc.parsedChart.trackData.push(emptyTrackData('guitar', 'expert'));
    expect(
      findTrack(doc, {instrument: 'drums', difficulty: 'expert'}),
    ).toBeNull();
  });

  it('finds the right track and reports its index', () => {
    const doc = emptyDoc();
    doc.parsedChart.trackData.push(emptyTrackData('guitar', 'expert'));
    doc.parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
    const result = findTrack(doc, {instrument: 'drums', difficulty: 'expert'});
    expect(result).not.toBeNull();
    expect(result!.track.instrument).toBe('drums');
    expect(result!.track.difficulty).toBe('expert');
    expect(result!.index).toBe(1);
  });

  it('matches the first track when duplicates exist (no chart should have these, but the helper is total)', () => {
    const doc = emptyDoc();
    doc.parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
    doc.parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
    const result = findTrack(doc, {instrument: 'drums', difficulty: 'expert'});
    expect(result!.index).toBe(0);
  });

  it('findTrackOnly drops the index wrapper', () => {
    const doc = emptyDoc();
    doc.parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
    const track = findTrackOnly(doc, {
      instrument: 'drums',
      difficulty: 'expert',
    });
    expect(track).toBe(doc.parsedChart.trackData[0]);
  });

  it('findTrackOnly returns null when missing', () => {
    const doc = emptyDoc();
    expect(
      findTrackOnly(doc, {instrument: 'drums', difficulty: 'expert'}),
    ).toBeNull();
  });
});
