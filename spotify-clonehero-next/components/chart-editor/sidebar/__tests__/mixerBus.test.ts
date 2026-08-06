/**
 * Stems mixer solo bus (plan 0074 Phase 5, Suite 6). The policy the mixer's
 * volume push and its row rendering both read, exercised directly as a
 * table rather than through the DOM.
 */

import {defaultVolumeFor, resolveMixer, type MixerRowState} from '../mixerBus';

function row(patch: Partial<MixerRowState> = {}): MixerRowState {
  return {volume: 100, mute: false, solo: false, ...patch};
}

describe('defaultVolumeFor', () => {
  it('starts real stems at full and the click silent', () => {
    expect(defaultVolumeFor('song')).toBe(100);
    expect(defaultVolumeFor('drums')).toBe(100);
    expect(defaultVolumeFor('click')).toBe(0);
  });

  it('starts the click audible on a project with no audio', () => {
    // The click is the only thing there is to hear, so a silent default
    // would make Play do nothing with nothing to explain it.
    expect(defaultVolumeFor('click', {silentProject: true})).toBe(70);
    expect(defaultVolumeFor('song', {silentProject: true})).toBe(100);
  });
});

describe('resolveMixer', () => {
  it('passes slider values through when nothing is muted or solo’d', () => {
    const {anySolo, resolved} = resolveMixer({
      song: row({volume: 100}),
      drums: row({volume: 40}),
    });
    expect(anySolo).toBe(false);
    expect(resolved['song']).toEqual({volume: 1, dimmedBySolo: false});
    expect(resolved['drums']).toEqual({volume: 0.4, dimmedBySolo: false});
  });

  it('mute silences only its own row', () => {
    const {resolved} = resolveMixer({
      song: row({mute: true}),
      drums: row(),
    });
    expect(resolved['song'].volume).toBe(0);
    expect(resolved['drums'].volume).toBe(1);
  });

  it('a solo silences every other solo-eligible row', () => {
    const {anySolo, resolved} = resolveMixer({
      song: row(),
      drums: row({solo: true}),
      vocals: row(),
    });
    expect(anySolo).toBe(true);
    expect(resolved['drums']).toEqual({volume: 1, dimmedBySolo: false});
    expect(resolved['song']).toEqual({volume: 0, dimmedBySolo: true});
    expect(resolved['vocals']).toEqual({volume: 0, dimmedBySolo: true});
  });

  it('supports multiple simultaneous solos', () => {
    const {resolved} = resolveMixer({
      song: row(),
      drums: row({solo: true}),
      vocals: row({solo: true}),
    });
    expect(resolved['drums'].volume).toBe(1);
    expect(resolved['vocals'].volume).toBe(1);
    expect(resolved['song'].volume).toBe(0);
  });

  it('reports an explicitly muted row as muted, not solo-silenced', () => {
    const {resolved} = resolveMixer({
      song: row({mute: true}),
      drums: row({solo: true}),
    });
    expect(resolved['song']).toEqual({volume: 0, dimmedBySolo: false});
  });

  it('keeps a muted row silent even when it is the solo’d one', () => {
    const {resolved} = resolveMixer({
      song: row(),
      drums: row({mute: true, solo: true}),
    });
    expect(resolved['drums'].volume).toBe(0);
    expect(resolved['song'].volume).toBe(0);
  });

  it('exempts the click from other rows’ solos', () => {
    const {resolved} = resolveMixer({
      song: row(),
      drums: row({solo: true}),
      click: row({volume: 30}),
    });
    expect(resolved['click']).toEqual({volume: 0.3, dimmedBySolo: false});
  });

  it('does not let a solo on the click row silence anything', () => {
    const {anySolo, resolved} = resolveMixer({
      song: row(),
      click: row({volume: 30, solo: true}),
    });
    expect(anySolo).toBe(false);
    expect(resolved['song'].volume).toBe(1);
  });

  it('still mutes the click when the click itself is muted', () => {
    const {resolved} = resolveMixer({click: row({volume: 50, mute: true})});
    expect(resolved['click'].volume).toBe(0);
  });

  it('resolves an empty mixer to nothing', () => {
    expect(resolveMixer({})).toEqual({anySolo: false, resolved: {}});
  });
});
