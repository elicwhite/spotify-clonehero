import {backgroundVideoTime} from '../backgroundVideoTime';

const base = {videoDurationSeconds: 200, songDurationSeconds: 210};

describe('backgroundVideoTime', () => {
  it('skips the front of the video by a positive start time', () => {
    expect(
      backgroundVideoTime({
        ...base,
        audioTimeSeconds: 10,
        videoStartSeconds: 4.9,
      }),
    ).toBeCloseTo(14.9);
  });

  it('holds the video back by a negative start time', () => {
    const at = (audioTimeSeconds: number) =>
      backgroundVideoTime({...base, audioTimeSeconds, videoStartSeconds: -3});
    expect(at(2)).toBeNull();
    expect(at(5)).toBeCloseTo(2);
  });

  it('shows no frame once a synced video has ended', () => {
    expect(
      backgroundVideoTime({
        ...base,
        audioTimeSeconds: 205,
        videoStartSeconds: 0,
      }),
    ).toBeNull();
  });

  it('loops a short video with no start time', () => {
    expect(
      backgroundVideoTime({
        audioTimeSeconds: 70,
        videoStartSeconds: 0,
        videoDurationSeconds: 30,
        songDurationSeconds: 210,
      }),
    ).toBeCloseTo(10);
  });

  it('does not loop a short video that has a start time', () => {
    expect(
      backgroundVideoTime({
        audioTimeSeconds: 70,
        videoStartSeconds: 1,
        videoDurationSeconds: 30,
        songDurationSeconds: 210,
      }),
    ).toBeNull();
  });

  it('shows no frame before the video has metadata', () => {
    expect(
      backgroundVideoTime({
        audioTimeSeconds: 10,
        videoStartSeconds: 0,
        videoDurationSeconds: NaN,
        songDurationSeconds: 210,
      }),
    ).toBeNull();
  });
});
