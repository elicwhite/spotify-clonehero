// Read-mostly probes into the running chart editor (`window.__recEditor`),
// for the chart editor's recorder adapter.
//
// Injected at document start after virtual-clock.js, fiber.js and dom.js;
// nothing runs until a script calls a method. Every probe finds the
// editor's own objects through React's fiber tree (`window.__recFiber`), so
// a script can aim its input at what the product actually drew and read
// back where the product thinks it is. Boxes come from `window.__recDom`.
//
// The one write is `pin(songSec)`: while recording, the editor's
// AudioManager reports exactly the film's song time from `currentTime`, so
// every surface that reads it in a frame (piano roll, highway, transport)
// draws the same instant regardless of the order their rAF callbacks run in.
//
// Lyric text never leaves the page: no probe returns it.

(() => {
  'use strict';
  if (window.__recEditor) return;
  const F = window.__recFiber;
  const rect = window.__recDom.box;

  const grid = () => document.querySelector('.chart-editor-grid');

  const audioService = () =>
    F.contextValue(
      grid(),
      v =>
        typeof v.getAudioManager === 'function' &&
        typeof v.setAudioManager === 'function',
    );
  const editor = () =>
    F.contextValue(grid(), v => v.state && v.dispatch && 'chartDoc' in v.state);

  const pinned = {sec: null, manager: null};
  const pinManager = manager => {
    if (!manager || pinned.manager === manager) return;
    const proto = Object.getPrototypeOf(manager);
    const own = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    if (!own || !own.get)
      throw new Error('AudioManager has no currentTime getter');
    Object.defineProperty(manager, 'currentTime', {
      configurable: true,
      get() {
        return pinned.sec === null ? own.get.call(this) : pinned.sec;
      },
    });
    pinned.manager = manager;
  };

  const rollCanvases = () => {
    const handle = document.querySelector(
      '[aria-label="Resize piano-roll panel"]',
    );
    const container = handle ? handle.parentElement : null;
    return {
      handle,
      container,
      canvases: container ? [...container.querySelectorAll('canvas')] : [],
    };
  };
  const isView = v => 'pxPerMs' in v && 'leftMs' in v && 'follow' in v;
  const isScene = v =>
    Array.isArray(v.rows) &&
    Array.isArray(v.lanes) &&
    Array.isArray(v.notes) &&
    'timedTempos' in v;

  /** The first value `find(canvas)` returns over the roll's canvases. */
  const overCanvases = find => {
    for (const canvas of rollCanvases().canvases) {
      const found = find(canvas);
      if (found) return found;
    }
    return null;
  };
  /** The piano roll component's fiber: the one holding the view ref. */
  const rollFiber = () => overCanvases(c => F.fiberWithRef(c, isView));
  const rollView = () => overCanvases(c => F.refValue(c, isView));
  const rollScene = () => overCanvases(c => F.refValue(c, isScene));
  /** The roll's plain `useRef` objects (a ref and nothing else), in hook order. */
  const rollRefs = () =>
    F.refsOf(rollFiber()).filter(r => Object.keys(r).length === 1);

  const POINTER_MODES = new Set([
    'idle',
    'drag',
    'marquee',
    'scrub',
    'resize',
    'place-drag',
    'erase',
    'lyric',
    'phrase-edge',
    'tempo',
    'timesig',
    'section',
    'loop',
    'song-start',
  ]);
  const has = (o, keys) => keys.every(k => k in o);
  /** The roll's live gesture refs (what it previews while a pointer is down). */
  const rollGestures = () => {
    const out = {
      mode: null,
      drag: null,
      resize: null,
      marquee: null,
      place: null,
    };
    for (const ref of rollRefs()) {
      const c = ref.current;
      const key = () =>
        c.trackKey ? c.trackKey.instrument + ':' + c.trackKey.difficulty : null;
      if (typeof c === 'string' && POINTER_MODES.has(c) && out.mode === null)
        out.mode = c;
      else if (c && typeof c === 'object') {
        if (
          has(c, [
            'anchorTick',
            'anchorLane',
            'tickDelta',
            'laneDelta',
            'active',
          ])
        ) {
          out.drag = {
            track: key(),
            anchorTick: c.anchorTick,
            anchorLane: c.anchorLane,
            tickDelta: c.tickDelta,
            laneDelta: c.laneDelta,
            active: c.active,
          };
        } else if (
          has(c, ['noteId', 'originalLength', 'currentLength', 'active'])
        ) {
          out.resize = {
            track: key(),
            noteId: c.noteId,
            originalLength: c.originalLength,
            currentLength: c.currentLength,
            active: c.active,
          };
        } else if (has(c, ['rowScoped', 'x0', 'y0', 'x1', 'y1'])) {
          out.marquee = {
            track: key(),
            rowScoped: c.rowScoped,
            x0: c.x0,
            y0: c.y0,
            x1: c.x1,
            y1: c.y1,
          };
        } else if (
          has(c, ['lane', 'startTick', 'currentTick', 'active']) &&
          'trackKey' in c
        ) {
          out.place = {
            track: key(),
            lane: c.lane,
            startTick: c.startTick,
            currentTick: c.currentTick,
            active: c.active,
          };
        }
      }
    }
    return out;
  };
  let lastDoc = null;

  const api = {
    audioManager() {
      const service = audioService();
      return service ? service.getAudioManager() : null;
    },
    /** Pin the AudioManager's playback position (audio seconds); null unpins. */
    pin(sec) {
      const manager = api.audioManager();
      if (!manager) throw new Error('no AudioManager');
      pinManager(manager);
      pinned.sec = sec;
      return manager.currentTime;
    },
    /** What the product reports this instant. */
    transport() {
      const manager = api.audioManager();
      const ed = editor();
      return {
        currentTime: manager ? manager.currentTime : null,
        chartTime: manager ? manager.chartTime : null,
        isPlaying: manager ? manager.isPlaying : null,
        delay: manager ? manager.delay : null,
        statePlaying: ed ? ed.state.isPlaying : null,
        activeScope: ed ? ed.state.activeScope : null,
        activeTool: ed ? ed.state.activeTool : null,
        gridDivision: ed ? ed.state.gridDivision : null,
        visibleTrackKeys:
          ed && ed.state.visibleTrackKeys
            ? [...ed.state.visibleTrackKeys]
            : null,
        pinned: pinned.sec,
      };
    },
    view() {
      const view = rollView();
      return view
        ? {leftMs: view.leftMs, pxPerMs: view.pxPerMs, follow: view.follow}
        : null;
    },
    /**
     * The piano roll's scene and layout, minus any lyric text: note ticks,
     * lanes and ids per row, the tempo map, and where the panel sits.
     */
    roll() {
      const {handle, container, canvases} = rollCanvases();
      const scene = rollScene();
      if (!container || !scene) return null;
      const rowsBox = canvases.find(c => c.dataset.pianoRollRegion === 'rows');
      const topCanvas = canvases.find(c => !c.dataset.pianoRollRegion);
      const stripNote = n => ({
        id: n.id,
        tick: n.tick,
        lane: n.lane,
        length: n.length ?? 0,
        flags: n.flags ?? 0,
      });
      return {
        container: rect(container),
        handle: rect(handle),
        canvases: canvases.map(c => ({
          region: c.dataset.pianoRollRegion ?? null,
          ...rect(c),
        })),
        rowsCanvas: rect(rowsBox),
        topCanvas: rect(topCanvas),
        scrollTop:
          rowsBox && rowsBox.parentElement
            ? rowsBox.parentElement.scrollTop
            : 0,
        resolution: scene.resolution,
        timedTempos: scene.timedTempos.map(t => ({
          tick: t.tick,
          msTime: t.msTime,
          bpm: t.beatsPerMinute ?? t.bpm,
        })),
        lyricsVisible: scene.lyricsVisible,
        activeTrackKey: scene.activeTrackKey,
        lanes: scene.lanes.map(l => l.name),
        notes: scene.notes.map(stripNote),
        rows: scene.rows.map(r => ({
          key: r.key,
          lanes: r.lanes.map(l => l.name),
          notes: r.notes.map(stripNote),
        })),
        view: api.view(),
      };
    },
    /** The roll's layout and view without any notes: cheap enough per frame. */
    rollFrame() {
      const {container, canvases} = rollCanvases();
      const scene = rollScene();
      if (!container || !scene) return null;
      return {
        container: rect(container),
        canvases: canvases.map(c => ({
          region: c.dataset.pianoRollRegion ?? null,
          ...rect(c),
        })),
        lyricsVisible: scene.lyricsVisible,
        activeTrackKey: scene.activeTrackKey,
        lanes: scene.lanes.map(l => l.name),
        rows: scene.rows.map(r => ({
          key: r.key,
          lanes: r.lanes.map(l => l.name),
        })),
        view: api.view(),
      };
    },
    /**
     * Editing state this frame: tool, selected note ids (track-qualified,
     * "guitar:expert|768:yellow"), the roll's live gesture previews, and
     * whether the chart document changed since the previous call.
     */
    editFrame() {
      const ed = editor();
      if (!ed) return null;
      const st = ed.state;
      const doc = st.chartDoc;
      const changed = lastDoc !== null && doc !== lastDoc;
      lastDoc = doc;
      return {
        tool: st.activeTool,
        selectedNotes: [...(st.selection.get('note') ?? [])],
        gesture: rollGestures(),
        undoDepth: st.undoEntries.length,
        docChanged: changed,
      };
    },
    /** A track's notes as the chart document holds them (ms window optional). */
    trackNotes(instrument, difficulty, fromMs = -Infinity, toMs = Infinity) {
      const ed = editor();
      const doc = ed && ed.state.chartDoc;
      if (!doc) return null;
      const track = doc.parsedChart.trackData.find(
        t => t.instrument === instrument && t.difficulty === difficulty,
      );
      if (!track) return null;
      return track.noteEventGroups
        .flat()
        .filter(n => n.msTime >= fromMs && n.msTime <= toMs)
        .map(n => ({
          tick: n.tick,
          msTime: Math.round(n.msTime * 1000) / 1000,
          type: n.type,
          length: n.length,
          flags: n.flags,
        }));
    },
    /**
     * The lyrics row's syllable pills as geometry only (song ms and the
     * measured text width the roll sizes each pill from): no text.
     */
    lyricPills() {
      const scene = rollScene();
      if (!scene) return null;
      const ids = new Set(scene.lyricChips.map(c => c.id));
      const widths =
        rollRefs()
          .map(r => r.current)
          .find(value => {
            if (!(value instanceof Map) || value.size === 0) return false;
            const [k, v] = value.entries().next().value;
            return ids.has(k) && typeof v === 'number';
          }) ?? null;
      return scene.lyricChips.map(c => ({
        id: c.id,
        ms: c.ms,
        width: widths ? (widths.get(c.id) ?? null) : null,
      }));
    },
    /** Chart Matrix cells by track key ("guitar:expert"): pressed + box. */
    matrix() {
      const out = {};
      for (const b of document.querySelectorAll('aside button[aria-pressed]')) {
        const m = (b.getAttribute('aria-label') || '').match(
          /^(Guitar|Bass|Drums|Keys|Rhythm)\s+(Expert|Hard|Medium|Easy)$/i,
        );
        if (!m) continue;
        out[(m[1] + ':' + m[2]).toLowerCase()] = {
          pressed: b.getAttribute('aria-pressed') === 'true',
          ...rect(b),
        };
      }
      return out;
    },
    editorState() {
      const ed = editor();
      return ed ? ed.state : null;
    },
    /** Dispatch an action to the editor's own reducer (e.g. SET_SELECTION). */
    dispatch(action) {
      const ed = editor();
      if (!ed) throw new Error('no editor context');
      ed.dispatch(action);
    },
  };
  Object.defineProperty(window, '__recEditor', {
    value: api,
    configurable: false,
    enumerable: false,
  });
})();
