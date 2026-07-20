/**
 * `ProjectMetadata.audioAnchor` persistence (plan 0064 addendum §1):
 * mirrors the in-memory `ChartDocument.audioAnchor` so leading-silence
 * padding survives a reload. `updateProject` must round-trip it, including
 * explicitly clearing it back to `null` (regenerate's contract).
 */

import {installFakeOPFS} from './fake-opfs';
import * as opfs from '../opfs';

describe('ProjectMetadata.audioAnchor', () => {
  let _fake: ReturnType<typeof installFakeOPFS>;

  beforeEach(() => {
    _fake = installFakeOPFS();
  });

  it('is absent on a freshly created project', async () => {
    const meta = await opfs.createProject('song');
    expect(meta.audioAnchor).toBeUndefined();
  });

  it('updateProject round-trips a set audioAnchor', async () => {
    const meta = await opfs.createProject('song');
    const updated = await opfs.updateProject(meta.id, {
      audioAnchor: {tick: 1536, ms: 3238.9},
    });
    expect(updated.audioAnchor).toEqual({tick: 1536, ms: 3238.9});

    const reread = await opfs.getProject(meta.id);
    expect(reread.audioAnchor).toEqual({tick: 1536, ms: 3238.9});
  });

  it('updateProject clears audioAnchor back to null', async () => {
    const meta = await opfs.createProject('song');
    await opfs.updateProject(meta.id, {audioAnchor: {tick: 100, ms: 200}});

    const cleared = await opfs.updateProject(meta.id, {audioAnchor: null});
    expect(cleared.audioAnchor).toBeNull();

    const reread = await opfs.getProject(meta.id);
    expect(reread.audioAnchor).toBeNull();
  });

  it('leaves audioAnchor untouched when not included in the update', async () => {
    const meta = await opfs.createProject('song');
    await opfs.updateProject(meta.id, {audioAnchor: {tick: 100, ms: 200}});

    const updated = await opfs.updateProject(meta.id, {stage: 'editing'});
    expect(updated.audioAnchor).toEqual({tick: 100, ms: 200});
  });
});
