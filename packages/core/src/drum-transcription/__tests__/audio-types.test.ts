import {
  fileNameToDisplayName,
  formatDuration,
  formatFileSize,
  TARGET_SAMPLE_RATE,
  TARGET_CHANNELS,
} from '../audio/types';

describe('fileNameToDisplayName', () => {
  it('strips the extension from a typical file name', () => {
    expect(fileNameToDisplayName('my_song.mp3')).toBe('my_song');
  });

  it('strips only the last extension', () => {
    expect(fileNameToDisplayName('archive.tar.gz')).toBe('archive.tar');
  });

  it('returns the full name if there is no extension', () => {
    expect(fileNameToDisplayName('noextension')).toBe('noextension');
  });

  it('returns the full name if the dot is at position 0 (hidden file)', () => {
    expect(fileNameToDisplayName('.hidden')).toBe('.hidden');
  });

  it('handles empty string', () => {
    expect(fileNameToDisplayName('')).toBe('');
  });

  it('strips extension from name with spaces', () => {
    expect(fileNameToDisplayName('My Song (Live).wav')).toBe('My Song (Live)');
  });
});

describe('formatDuration', () => {
  it('formats zero duration', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats a duration under a minute', () => {
    expect(formatDuration(45000)).toBe('0:45');
  });

  it('pads seconds with leading zero', () => {
    expect(formatDuration(65000)).toBe('1:05');
  });

  it('formats a multi-minute duration', () => {
    expect(formatDuration(125400)).toBe('2:05');
  });

  it('formats a long duration', () => {
    expect(formatDuration(3661000)).toBe('61:01');
  });

  it('truncates sub-second precision', () => {
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(1500)).toBe('0:01');
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(2067853)).toBe('2.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1500000000)).toBe('1.4 GB');
  });

  it('formats zero', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });
});

describe('constants', () => {
  it('TARGET_SAMPLE_RATE is 44100', () => {
    expect(TARGET_SAMPLE_RATE).toBe(44100);
  });

  it('TARGET_CHANNELS is 2', () => {
    expect(TARGET_CHANNELS).toBe(2);
  });
});
