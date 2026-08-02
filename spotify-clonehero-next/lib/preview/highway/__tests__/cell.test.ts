import * as THREE from 'three';
import {createHighwayClippingPlanes, noteClippingPlanesForTrack} from '../cell';
import type {Track} from '../types';

describe('note clipping planes', () => {
  it('relaxes five-fret flame clipping without changing drum clipping', () => {
    const shared = createHighwayClippingPlanes();

    const guitarPlanes = noteClippingPlanesForTrack(
      {instrument: 'guitar'} as Pick<Track, 'instrument'>,
      shared,
    );
    const drumPlanes = noteClippingPlanesForTrack(
      {instrument: 'drums'} as Pick<Track, 'instrument'>,
      shared,
    );

    expect(guitarPlanes).not.toBe(shared.note);
    expect(guitarPlanes[0]).toBeInstanceOf(THREE.Plane);
    expect(guitarPlanes[0].normal.y).toBe(1);
    expect(guitarPlanes[0].constant).toBe(1.1);
    expect(guitarPlanes[1]).toBe(shared.note[1]);
    expect(drumPlanes).toBe(shared.note);
  });
});
