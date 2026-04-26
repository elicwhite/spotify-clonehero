'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  useChartEditorContext,
  getSelectedIds,
} from './ChartEditorContext';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  AddSectionCommand,
  RenameSectionCommand,
  noteId,
  typeToLane,
  laneToType,
  defaultFlagsForType,
} from './commands';
import {
  buildTimedTempos,
  msToTick,
  snapToGrid,
} from '@/lib/drum-transcription/timing';
import {getDrumNotes} from '@/lib/chart-edit';
import DrumHighwayPreview, {
  type HighwayRendererHandle,
} from './DrumHighwayPreview';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {InteractionManager} from '@/lib/preview/highway';
import type {HitResult} from '@/lib/preview/highway';
import {chartToElements} from '@/lib/preview/highway/chartToElements';
import {parseChartFile} from '@eliwhite/scan-chart';
type ParsedChart = ReturnType<typeof parseChartFile>;
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

/**
 * Tick to which a HitResult corresponds for cursor / placement purposes.
 * Returns null for `null` hits and the empty highway (which already has its
 * own `tick` field — caller should branch on `hit?.type === 'highway'` if
 * needed). Phrase-end uses its `endTick`; lyrics use their own `tick`.
 */
function hitTick(hit: HitResult): number | null {
  if (!hit) return null;
  switch (hit.type) {
    case 'note':
    case 'section':
    case 'lyric':
    case 'phrase-start':
    case 'highway':
      return hit.tick;
    case 'phrase-end':
      return hit.endTick;
  }
}

/**
 * Translate a side-marker hit (section/lyric/phrase-start/phrase-end) into
 * its EntityKind + id. Notes and highway hits have separate paths.
 */
function markerHitToRef(
  hit: HitResult,
):
  | {
      kind: 'section' | 'lyric' | 'phrase-start' | 'phrase-end';
      id: string;
      tick: number;
    }
  | null {
  if (!hit) return null;
  switch (hit.type) {
    case 'section':
    case 'lyric':
    case 'phrase-start':
      return {kind: hit.type, id: String(hit.tick), tick: hit.tick};
    case 'phrase-end':
      return {
        kind: 'phrase-end',
        id: String(hit.endTick),
        tick: hit.endTick,
      };
    default:
      return null;
  }
}

interface HighwayEditorProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string;
  /** Optional confidence scores for notes, keyed by noteId (tick:type). */
  confidence?: Map<string, number>;
  /** Whether to show confidence overlays. Defaults to false. */
  showConfidence?: boolean;
  /** Confidence threshold below which notes are flagged. Defaults to 0.7. */
  confidenceThreshold?: number;
  /** Set of note IDs that have been reviewed by the user. */
  reviewedNoteIds?: Set<string>;
  /** Raw PCM audio data for waveform highway surface. */
  audioData?: Float32Array;
  /** Number of audio channels. */
  audioChannels?: number;
  /** Total duration in seconds. */
  durationSeconds?: number;
}

/**
 * Wraps DrumHighwayPreview with a transparent interaction layer.
 *
 * Mouse events are captured by a transparent <div>, then delegated to
 * InteractionManager for hit-testing (raycasting against note sprites,
 * section banners, and the highway plane). React decides what to do
 * with the results (select, place, erase, etc.).
 *
 * All edits go through the command system via useExecuteCommand.
 */
export default function HighwayEditor({
  metadata,
  chart,
  audioManager,
  className,
  confidence,
  showConfidence = false,
  confidenceThreshold = 0.7,
  reviewedNoteIds,
  audioData,
  audioChannels = 2,
  durationSeconds,
}: HighwayEditorProps) {
  const {
    state,
    dispatch,
    audioManagerRef,
    reconcilerRef,
    noteRendererRef,
    capabilities,
  } = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();

  const interactionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Three.js renderer handle for coordinate mapping.
  // rendererVersion is bumped whenever the handle changes so that useEffects
  // that depend on it re-run (refs alone don't trigger re-renders).
  const rendererHandleRef = useRef<HighwayRendererHandle | null>(null);
  const [rendererVersion, setRendererVersion] = useState(0);

  const readyGenerationRef = useRef(0);
  const handleRendererReady = useCallback(
    (handle: HighwayRendererHandle | null) => {
      rendererHandleRef.current = handle;
      if (!handle) {
        interactionManagerRef.current = null;
        reconcilerRef.current = null;
        noteRendererRef.current = null;
        setRendererVersion(v => v + 1);
        return;
      }
      // Resolve all managers from the single trackPromise.
      // Generation counter avoids stale resolutions if called multiple times.
      const gen = ++readyGenerationRef.current;
      Promise.all([
        handle.getReconciler(),
        handle.getInteractionManager(),
        handle.getNoteRenderer(),
      ]).then(([rec, im, nr]) => {
        if (readyGenerationRef.current !== gen) return;
        reconcilerRef.current = rec;
        interactionManagerRef.current = im;
        noteRendererRef.current = nr;
        setRendererVersion(v => v + 1);
      });
    },
    [reconcilerRef, noteRendererRef],
  );

  // Interaction state
  const [hoverLane, setHoverLane] = useState<number | null>(null);
  const [hoverTick, setHoverTick] = useState<number | null>(null);
  const [hoveredHitType, setHoveredHitType] = useState<
    | 'note'
    | 'section'
    | 'lyric'
    | 'phrase-start'
    | 'phrase-end'
    | 'highway'
    | null
  >(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{x: number; y: number} | null>(
    null,
  );
  const [dragCurrent, setDragCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isErasing, setIsErasing] = useState(false);

  // Popover state for BPM/TimeSig/Section editing
  const [popover, setPopover] = useState<{
    kind: 'bpm' | 'timesig' | 'section' | 'section-rename';
    tick: number;
    x: number;
    y: number;
  } | null>(null);
  const [bpmInput, setBpmInput] = useState('120');
  const [tsNumerator, setTsNumerator] = useState('4');
  const [tsDenominator, setTsDenominator] = useState('4');
  const [sectionNameInput, setSectionNameInput] = useState('');

  // Single-entity marker drag state (sections, lyrics, phrase-start, phrase-end).
  // Note drag is multi-entity and uses `isDragging` + `state.selection`.
  const [markerDrag, setMarkerDrag] = useState<{
    kind: 'section' | 'lyric' | 'phrase-start' | 'phrase-end';
    originalTick: number;
    /** Latest tick during drag — drives the ghost preview. */
    currentTick: number;
  } | null>(null);

  // Double-click tracking for section rename
  const lastClickRef = useRef<{tick: number; time: number} | null>(null);

  // Compute timed tempos for coordinate mapping
  const timedTempos = useMemo(() => {
    if (!state.chartDoc) return [];
    return buildTimedTempos(
      state.chartDoc.parsedChart.tempos,
      state.chartDoc.parsedChart.resolution,
    );
  }, [state.chartDoc]);

  const resolution = state.chartDoc?.parsedChart.resolution ?? 480;

  // Get the expert drums notes for hit-testing
  const expertNotes = useMemo(() => {
    if (!state.chartDoc) return [];
    const track = state.chartDoc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    return track ? getDrumNotes(track) : [];
  }, [state.chartDoc]);

  // ---------------------------------------------------------------------------
  // InteractionManager ref — resolved asynchronously from the renderer handle
  // ---------------------------------------------------------------------------

  const interactionManagerRef = useRef<InteractionManager | null>(null);

  // InteractionManager is resolved in handleRendererReady (above)

  // ---------------------------------------------------------------------------
  // Waveform / Grid surface setup
  // ---------------------------------------------------------------------------

  // Send waveform audio data to the renderer when available
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || !audioData || !durationSeconds) return;
    handle.setWaveformData({
      audioData,
      channels: audioChannels,
      durationMs: durationSeconds * 1000,
    });
  }, [rendererVersion, audioData, audioChannels, durationSeconds]);

  // Send grid data (tempos + time signatures) to the renderer
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || !state.chartDoc || !durationSeconds) return;
    const tempos = state.chartDoc.parsedChart.tempos.map(t => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
    }));
    const timeSignatures = state.chartDoc.parsedChart.timeSignatures.map(
      ts => ({
        tick: ts.tick,
        numerator: ts.numerator,
        denominator: ts.denominator,
      }),
    );
    handle.setGridData({
      tempos,
      timeSignatures,
      resolution: state.chartDoc.parsedChart.resolution,
      durationMs: durationSeconds * 1000,
    });
  }, [rendererVersion, state.chartDoc, durationSeconds]);

  // Sync highway mode from context to renderer
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle) return;
    handle.setHighwayMode(state.highwayMode);
  }, [rendererVersion, state.highwayMode]);

  // ---------------------------------------------------------------------------
  // Coordinate helpers via InteractionManager
  //
  // These thin wrappers delegate to InteractionManager. They read
  // audioManager.currentTime via InteractionManager's getElapsedMs closure,
  // so they don't need React state dependencies for time.
  // ---------------------------------------------------------------------------

  /** Get canvas dimensions from the interaction div. */
  const getCanvasSize = useCallback((): {w: number; h: number} => {
    const el = interactionRef.current;
    if (!el) return {w: 1, h: 1};
    return {w: el.offsetWidth, h: el.offsetHeight};
  }, []);

  const screenToLane = useCallback(
    (x: number, y: number): number => {
      const im = interactionManagerRef.current;
      if (!im) return 0;
      const {w, h} = getCanvasSize();
      return im.screenToLane(x, y, w, h);
    },
    [getCanvasSize],
  );

  const screenToMs = useCallback(
    (x: number, y: number): number => {
      const im = interactionManagerRef.current;
      if (!im) return 0;
      const {w, h} = getCanvasSize();
      return im.screenToMs(x, y, w, h);
    },
    [getCanvasSize],
  );

  const screenToTick = useCallback(
    (x: number, y: number): number => {
      const im = interactionManagerRef.current;
      if (!im) return 0;
      const {w, h} = getCanvasSize();
      return im.screenToTick(x, y, w, h, state.gridDivision);
    },
    [getCanvasSize, state.gridDivision],
  );

  /**
   * Perform a hit-test at the given element-relative coordinates.
   * Returns a HitResult (note, section, highway, or null).
   */
  const hitTestAt = useCallback(
    (x: number, y: number): HitResult => {
      const im = interactionManagerRef.current;
      if (!im) return null;
      const {w, h} = getCanvasSize();
      return im.hitTest(x, y, w, h, state.gridDivision);
    },
    [getCanvasSize, state.gridDivision],
  );

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  /**
   * Get pixel coordinates relative to the interaction element.
   * Since this is a DOM div (not a canvas), coords match the element's
   * CSS pixel dimensions directly (no canvas scale factor needed).
   * The Three.js camera uses the renderer's canvas which is sized to
   * match this same div, so these coords map correctly.
   */
  const getElementCoords = (
    e: ReactMouseEvent<HTMLDivElement>,
  ): {x: number; y: number} => {
    const el = interactionRef.current!;
    const rect = el.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const coords = getElementCoords(e);
      const hit = hitTestAt(coords.x, coords.y);
      const lane =
        hit && 'lane' in hit ? hit.lane : screenToLane(coords.x, coords.y);
      const tick = hitTick(hit) ?? screenToTick(coords.x, coords.y);

      switch (state.activeTool) {
        case 'cursor': {
          const markerRef = markerHitToRef(hit);

          // Section: double-click → rename popover (drum-edit only).
          if (
            markerRef?.kind === 'section' &&
            capabilities.selectable.has('section')
          ) {
            const now = Date.now();
            const last = lastClickRef.current;
            if (last && last.tick === markerRef.tick && now - last.time < 400) {
              lastClickRef.current = null;
              setSectionNameInput(
                hit?.type === 'section' ? hit.name : '',
              );
              setPopover({
                kind: 'section-rename',
                tick: markerRef.tick,
                x: coords.x,
                y: coords.y,
              });
              dispatch({
                type: 'SET_SELECTION',
                kind: 'section',
                ids: new Set([markerRef.id]),
              });
              break;
            }
            lastClickRef.current = {tick: markerRef.tick, time: now};
          }

          // Marker hit: select + (optionally) start single-entity drag.
          if (markerRef && capabilities.selectable.has(markerRef.kind)) {
            dispatch({
              type: 'SET_SELECTION',
              kind: markerRef.kind,
              ids: new Set([markerRef.id]),
            });
            // Clear note selection so the editor doesn't carry stale notes.
            if (getSelectedIds(state, 'note').size > 0) {
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
            }
            if (capabilities.draggable.has(markerRef.kind)) {
              setMarkerDrag({
                kind: markerRef.kind,
                originalTick: markerRef.tick,
                currentTick: markerRef.tick,
              });
              setDragStart(coords);
              setDragCurrent(coords);
            }
            break;
          }

          // Click missed any selectable marker — clear marker selections so
          // the panel doesn't keep showing stale state.
          for (const k of [
            'section',
            'lyric',
            'phrase-start',
            'phrase-end',
          ] as const) {
            if (getSelectedIds(state, k).size > 0) {
              dispatch({type: 'SET_SELECTION', kind: k, ids: new Set()});
            }
          }

          // Note hit: select + start multi-note drag (drum-edit only).
          if (hit?.type === 'note' && capabilities.selectable.has('note')) {
            const id = hit.noteId;
            const noteSelection = getSelectedIds(state, 'note');
            if (e.shiftKey) {
              const newIds = new Set(noteSelection);
              if (newIds.has(id)) {
                newIds.delete(id);
              } else {
                newIds.add(id);
              }
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: newIds});
            } else if (!noteSelection.has(id)) {
              dispatch({
                type: 'SET_SELECTION',
                kind: 'note',
                ids: new Set([id]),
              });
            }
            if (capabilities.draggable.has('note')) {
              setIsDragging(true);
            }
            setDragStart(coords);
            setDragCurrent(coords);
          } else if (capabilities.selectable.has('note')) {
            // Empty / inert hit when notes are selectable: box-select or deselect.
            if (!e.shiftKey) {
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
            }
            setDragStart(coords);
            setDragCurrent(coords);
          }
          break;
        }
        case 'place': {
          const type = laneToType(lane);
          // Toggle: if a note exists at this position, remove it
          if (hit?.type === 'note') {
            executeCommand(new DeleteNotesCommand(new Set([hit.noteId])));
          } else {
            executeCommand(
              new AddNoteCommand({
                tick,
                type,
                length: 0,
                flags: defaultFlagsForType(type),
              }),
            );
          }
          break;
        }
        case 'erase': {
          if (hit?.type === 'note') {
            executeCommand(new DeleteNotesCommand(new Set([hit.noteId])));
          }
          setIsErasing(true);
          break;
        }
        case 'bpm': {
          setPopover({
            kind: 'bpm',
            tick,
            x: coords.x,
            y: coords.y,
          });
          // Pre-fill with current BPM at this position
          if (timedTempos.length > 0) {
            let idx = 0;
            for (let i = 1; i < timedTempos.length; i++) {
              if (timedTempos[i].tick <= tick) idx = i;
              else break;
            }
            setBpmInput(String(timedTempos[idx].beatsPerMinute));
          }
          break;
        }
        case 'timesig': {
          setPopover({
            kind: 'timesig',
            tick,
            x: coords.x,
            y: coords.y,
          });
          setTsNumerator('4');
          setTsDenominator('4');
          break;
        }
        case 'section': {
          setSectionNameInput('');
          setPopover({
            kind: 'section',
            tick,
            x: coords.x,
            y: coords.y,
          });
          break;
        }
      }
    },
    [
      state,
      capabilities,
      hitTestAt,
      screenToLane,
      screenToTick,
      timedTempos,
      executeCommand,
      dispatch,
    ],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const coords = getElementCoords(e);
      const hit = hitTestAt(coords.x, coords.y);

      // Update hover lane/tick from hit result
      if (hit) {
        setHoverLane(
          'lane' in hit ? hit.lane : screenToLane(coords.x, coords.y),
        );
        setHoverTick(hitTick(hit) ?? screenToTick(coords.x, coords.y));
        setHoveredHitType(hit.type);
      } else {
        setHoverLane(screenToLane(coords.x, coords.y));
        setHoverTick(screenToTick(coords.x, coords.y));
        setHoveredHitType(null);
      }

      // Update note hover highlight via NoteRenderer
      const hoveredNoteId = hit?.type === 'note' ? hit.noteId : null;
      noteRendererRef.current?.setHoveredNoteId(hoveredNoteId);

      if (dragStart) {
        setDragCurrent(coords);
      }

      // Marker drag: update the live preview tick
      if (markerDrag && dragStart) {
        const newTick = screenToTick(coords.x, coords.y);
        if (newTick !== markerDrag.currentTick) {
          setMarkerDrag({...markerDrag, currentTick: newTick});
        }
      }

      // Erase mode: paint-erase while dragging
      if (isErasing && state.activeTool === 'erase') {
        if (hit?.type === 'note') {
          executeCommand(new DeleteNotesCommand(new Set([hit.noteId])));
        }
      }
    },
    [
      hitTestAt,
      screenToLane,
      screenToTick,
      dragStart,
      isErasing,
      markerDrag,
      state.activeTool,
      executeCommand,
      noteRendererRef,
    ],
  );

  const handleMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const coords = getElementCoords(e);

      const noteSelection = getSelectedIds(state, 'note');
      if (state.activeTool === 'cursor' && dragStart && dragCurrent) {
        if (isDragging && noteSelection.size > 0) {
          // Complete drag-move
          const dx = coords.x - dragStart.x;
          const dy = coords.y - dragStart.y;
          // Only apply if moved more than a small threshold
          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            const laneDelta =
              screenToLane(coords.x, coords.y) -
              screenToLane(dragStart.x, dragStart.y);
            const startTick = screenToTick(dragStart.x, dragStart.y);
            const endTick = screenToTick(coords.x, coords.y);
            const tickDelta = endTick - startTick;
            if (laneDelta !== 0 || tickDelta !== 0) {
              executeCommand(
                new MoveEntitiesCommand(
                  'note',
                  Array.from(noteSelection),
                  tickDelta,
                  laneDelta,
                ),
              );
            }
          }
        } else {
          // Complete box selection
          const x1 = Math.min(dragStart.x, coords.x);
          const x2 = Math.max(dragStart.x, coords.x);
          const y1 = Math.min(dragStart.y, coords.y);
          const y2 = Math.max(dragStart.y, coords.y);

          // Only do box select if dragged more than a small threshold
          if (Math.abs(x2 - x1) > 5 || Math.abs(y2 - y1) > 5) {
            // y2 is lower on screen = earlier time (closer to camera)
            // y1 is higher on screen = later time (further from camera)
            const ms1 = screenToMs(x1, y2);
            const ms2 = screenToMs(x2, y1);
            const lane1 = screenToLane(x1, y1);
            const lane2 = screenToLane(x2, y2);
            const minLane = Math.min(lane1, lane2);
            const maxLane = Math.max(lane1, lane2);

            const selected = new Set<string>();
            for (const note of expertNotes) {
              const noteLane = typeToLane(note.type);
              if (noteLane < minLane || noteLane > maxLane) continue;

              // Convert tick to ms
              let tempoIdx = 0;
              for (let i = 1; i < timedTempos.length; i++) {
                if (timedTempos[i].tick <= note.tick) tempoIdx = i;
                else break;
              }
              const tempo = timedTempos[tempoIdx];
              const noteMs =
                tempo.msTime +
                ((note.tick - tempo.tick) * 60000) /
                  (tempo.beatsPerMinute * resolution);

              if (noteMs >= ms1 && noteMs <= ms2) {
                selected.add(noteId(note));
              }
            }

            if (e.shiftKey) {
              // Add to existing selection
              const merged = new Set(noteSelection);
              selected.forEach(id => merged.add(id));
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: merged});
            } else {
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: selected});
            }
          }
        }
      }

      // Complete single-entity marker drag (sections, lyrics, phrases).
      if (markerDrag && dragStart) {
        const dx = coords.x - dragStart.x;
        const dy = coords.y - dragStart.y;
        const moved =
          (Math.abs(dx) > 5 || Math.abs(dy) > 5) &&
          markerDrag.currentTick !== markerDrag.originalTick;
        if (moved) {
          const tickDelta = markerDrag.currentTick - markerDrag.originalTick;
          executeCommand(
            new MoveEntitiesCommand(
              markerDrag.kind,
              [String(markerDrag.originalTick)],
              tickDelta,
              0,
            ),
          );
          // Keep selection on the moved entity using its new id. Handlers
          // clamp on overshoot, so the actual id may differ; we re-derive
          // it here on a best-effort basis.
          dispatch({
            type: 'SET_SELECTION',
            kind: markerDrag.kind,
            ids: new Set([String(markerDrag.currentTick)]),
          });
        }
      }

      setIsDragging(false);
      setMarkerDrag(null);
      setDragStart(null);
      setDragCurrent(null);
      setIsErasing(false);
    },
    [
      state,
      dragStart,
      dragCurrent,
      isDragging,
      markerDrag,
      screenToLane,
      screenToTick,
      screenToMs,
      expertNotes,
      timedTempos,
      resolution,
      executeCommand,
      dispatch,
    ],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverLane(null);
    setHoverTick(null);
    setHoveredHitType(null);
    setIsErasing(false);
    // Clear note hover highlight
    noteRendererRef.current?.setHoveredNoteId(null);
    if (!isDragging && !markerDrag) {
      setDragStart(null);
      setDragCurrent(null);
    }
  }, [isDragging, markerDrag, noteRendererRef]);

  // ---------------------------------------------------------------------------
  // Wheel scrolling -- scrub cursor forward/backward by one grid step
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const el = interactionRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (state.isPlaying || !state.chartDoc) return;
      e.preventDefault();

      const am = audioManagerRef.current;
      if (!am) return;

      // Scroll by a fixed time amount per wheel tick (25ms).
      // deltaY < 0 = wheel up = scroll forward, deltaY > 0 = backward.
      const SCROLL_STEP_MS = 25;
      const direction = e.deltaY < 0 ? 1 : -1;
      const currentChartMs = am.chartTime * 1000;
      const maxChartMs = am.duration * 1000 - am.chartDelay * 1000;
      const targetChartMs = Math.max(
        0,
        Math.min(currentChartMs + direction * SCROLL_STEP_MS, maxChartMs),
      );

      am.playChartTime(targetChartMs / 1000).then(() => am.pause());

      // Update cursor tick to match
      if (timedTempos.length > 0) {
        const tick = msToTick(
          targetChartMs,
          timedTempos,
          state.chartDoc.parsedChart.resolution,
        );
        dispatch({type: 'SET_CURSOR_TICK', tick});
      }
    };

    el.addEventListener('wheel', handleWheel, {passive: false});
    return () => el.removeEventListener('wheel', handleWheel);
  }, [
    state.isPlaying,
    state.chartDoc,
    state.cursorTick,
    state.gridDivision,
    timedTempos,
    resolution,
    audioManagerRef,
    dispatch,
  ]);

  // ---------------------------------------------------------------------------
  // Popover submit handlers
  // ---------------------------------------------------------------------------

  const handleBpmSubmit = () => {
    if (!popover) return;
    const bpm = parseFloat(bpmInput);
    if (isNaN(bpm) || bpm <= 0) return;
    executeCommand(new AddBPMCommand(popover.tick, bpm));
    setPopover(null);
  };

  const handleTimeSigSubmit = () => {
    if (!popover) return;
    const num = parseInt(tsNumerator, 10);
    const den = parseInt(tsDenominator, 10);
    if (isNaN(num) || isNaN(den) || num <= 0 || den <= 0) return;
    // Denominator must be a power of 2
    if (!Number.isInteger(Math.log2(den))) return;
    executeCommand(new AddTimeSignatureCommand(popover.tick, num, den));
    setPopover(null);
  };

  const handleSectionSubmit = () => {
    if (!popover) return;
    const name = sectionNameInput.trim();
    if (!name) return;
    executeCommand(new AddSectionCommand(popover.tick, name));
    setPopover(null);
    setSectionNameInput('');
  };

  const handleSectionRenameSubmit = () => {
    if (!popover || popover.kind !== 'section-rename') return;
    const newName = sectionNameInput.trim();
    if (!newName) return;
    const section = state.chartDoc?.parsedChart.sections.find(
      s => s.tick === popover.tick,
    );
    if (!section || section.name === newName) {
      setPopover(null);
      return;
    }
    executeCommand(
      new RenameSectionCommand(popover.tick, section.name, newName),
    );
    setPopover(null);
    setSectionNameInput('');
  };

  // ---------------------------------------------------------------------------
  // Push overlay state to the Three.js renderer each time it changes.
  // The renderer's animation loop reads this every frame.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle) return;

    // Push overlay state to the Three.js render loop
    handle.setOverlayState({
      cursorTick: hoverTick ?? state.cursorTick,
      isPlaying: state.isPlaying,
      activeTool: state.activeTool,
      hoverLane,
      hoverTick,
      loopRegion: state.loopRegion,
    });

    // Push selection and confidence state to the NoteRenderer
    const nr = noteRendererRef.current;
    if (nr) {
      const noteSelection = state.selection.get('note') ?? new Set<string>();
      nr.setSelectedNoteIds(noteSelection);
      nr.setConfidenceData(
        confidence ?? null,
        showConfidence,
        confidenceThreshold,
      );
      nr.setReviewedNoteIds(reviewedNoteIds ?? null);
    }
  }, [
    state.cursorTick,
    state.isPlaying,
    state.activeTool,
    state.selection,
    state.chartDoc?.parsedChart.sections,
    state.loopRegion,
    hoverLane,
    hoverTick,
    confidence,
    showConfidence,
    confidenceThreshold,
    reviewedNoteIds,
    rendererVersion,
    noteRendererRef,
  ]);

  // Push timing data to SceneOverlays when tempos or resolution change
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || timedTempos.length === 0) return;
    handle.setTimingData(timedTempos, resolution);
  }, [timedTempos, resolution]);

  // Push full chart elements (notes + markers) to reconciler when chart
  // changes or reconciler first becomes available. This ensures marker
  // elements (sections, lyrics, BPM, TS, phrases) are present from the
  // start, not only after the first edit command.
  //
  // When the page disables drum lanes (e.g. add-lyrics), the source chart
  // may still carry a real drum track — drop the note elements so the
  // highway shows only markers + lyrics.
  useEffect(() => {
    const reconciler = reconcilerRef.current;
    if (!reconciler || !state.chart) return;
    const track = state.chart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!track) return;
    const elements = chartToElements(state.chart, track);
    const visible = capabilities.showDrumLanes
      ? elements
      : elements.filter(e => e.kind !== 'note');
    reconciler.setElements(visible);
  }, [reconcilerRef, state.chart, capabilities, rendererVersion]);

  // ---------------------------------------------------------------------------
  // Sync cursor tick with playback
  //
  // During playback, cursor follows audioManager.currentTime.
  // On stop, cursor stays at the current position.
  // ---------------------------------------------------------------------------

  const prevIsPlayingRef = useRef(state.isPlaying);

  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    prevIsPlayingRef.current = state.isPlaying;

    if (!state.isPlaying && wasPlaying && state.chartDoc) {
      // Just stopped: update cursor to current audio position
      const currentMs = (audioManagerRef.current?.currentTime ?? 0) * 1000;
      const cursorTick = msToTick(currentMs, timedTempos, resolution);
      const snapped =
        state.gridDivision === 0
          ? Math.max(0, cursorTick)
          : Math.max(0, snapToGrid(cursorTick, resolution, state.gridDivision));
      dispatch({type: 'SET_CURSOR_TICK', tick: snapped});
    }
    // audioManagerRef is a stable ref from context, not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.isPlaying,
    state.chartDoc,
    state.gridDivision,
    timedTempos,
    resolution,
    dispatch,
  ]);

  // ---------------------------------------------------------------------------
  // Cursor style based on tool mode and what's under the mouse
  // ---------------------------------------------------------------------------

  const cursorStyle = useMemo(() => {
    // When hovering over a note, show pointer in cursor/erase mode
    if (hoveredHitType === 'note') {
      if (state.activeTool === 'cursor' || state.activeTool === 'erase') {
        return 'pointer';
      }
    }
    // When hovering over a section banner, show pointer in cursor mode
    if (hoveredHitType === 'section' && state.activeTool === 'cursor') {
      return 'pointer';
    }
    // Default cursors per tool mode
    switch (state.activeTool) {
      case 'cursor':
        return 'default';
      case 'place':
        return 'crosshair';
      case 'erase':
        return 'pointer';
      case 'bpm':
      case 'timesig':
      case 'section':
        return 'crosshair';
      default:
        return 'default';
    }
  }, [state.activeTool, hoveredHitType]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      style={{cursor: cursorStyle}}>
      {/* The actual 3D highway renderer */}
      <DrumHighwayPreview
        metadata={metadata}
        chart={chart}
        audioManager={audioManager}
        className="h-full w-full"
        showDrumLanes={capabilities.showDrumLanes}
        onRendererReady={handleRendererReady}
      />

      {/* Transparent interaction layer for mouse events */}
      <div
        ref={interactionRef}
        className="absolute inset-0 z-10"
        style={{cursor: cursorStyle}}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Box selection rectangle (DOM div -- inherently screen-space) */}
      {state.activeTool === 'cursor' &&
        dragStart &&
        dragCurrent &&
        !isDragging &&
        (Math.abs(dragCurrent.x - dragStart.x) > 3 ||
          Math.abs(dragCurrent.y - dragStart.y) > 3) && (
          <div
            className="pointer-events-none absolute z-20 border"
            style={{
              left: Math.min(dragStart.x, dragCurrent.x),
              top: Math.min(dragStart.y, dragCurrent.y),
              width: Math.abs(dragCurrent.x - dragStart.x),
              height: Math.abs(dragCurrent.y - dragStart.y),
              backgroundColor: 'rgba(100, 149, 237, 0.25)',
              borderColor: 'rgba(100, 149, 237, 0.6)',
            }}
          />
        )}

      {/* BPM popover */}
      {popover?.kind === 'bpm' && (
        <div
          className="absolute z-20 rounded-lg border bg-background p-2 shadow-lg"
          style={{left: popover.x + 8, top: popover.y - 16}}>
          <form
            onSubmit={e => {
              e.preventDefault();
              handleBpmSubmit();
            }}
            className="flex items-center gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              BPM:
            </label>
            <Input
              type="number"
              value={bpmInput}
              onChange={e => setBpmInput(e.target.value)}
              className="h-7 w-20 text-xs"
              autoFocus
              min={1}
              step="any"
            />
            <Button type="submit" size="sm" className="h-7 px-2 text-xs">
              Set
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPopover(null)}>
              Cancel
            </Button>
          </form>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Tick: {popover.tick}
          </p>
        </div>
      )}

      {/* Time Signature popover */}
      {popover?.kind === 'timesig' && (
        <div
          className="absolute z-20 rounded-lg border bg-background p-2 shadow-lg"
          style={{left: popover.x + 8, top: popover.y - 16}}>
          <form
            onSubmit={e => {
              e.preventDefault();
              handleTimeSigSubmit();
            }}
            className="flex items-center gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              TS:
            </label>
            <Input
              type="number"
              value={tsNumerator}
              onChange={e => setTsNumerator(e.target.value)}
              className="h-7 w-12 text-xs"
              autoFocus
              min={1}
            />
            <span className="text-xs">/</span>
            <Input
              type="number"
              value={tsDenominator}
              onChange={e => setTsDenominator(e.target.value)}
              className="h-7 w-12 text-xs"
              min={1}
            />
            <Button type="submit" size="sm" className="h-7 px-2 text-xs">
              Set
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPopover(null)}>
              Cancel
            </Button>
          </form>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Tick: {popover.tick}
          </p>
        </div>
      )}

      {/* Section add popover */}
      {popover?.kind === 'section' && (
        <div
          className="absolute z-20 rounded-lg border bg-background p-2 shadow-lg"
          style={{left: popover.x + 8, top: popover.y - 16}}>
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSectionSubmit();
            }}
            className="flex items-center gap-1">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Section:
            </label>
            <Input
              type="text"
              value={sectionNameInput}
              onChange={e => setSectionNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setPopover(null);
                }
              }}
              className="h-7 w-32 text-xs"
              placeholder="e.g. verse 1"
              autoFocus
            />
            <Button type="submit" size="sm" className="h-7 px-2 text-xs">
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPopover(null)}>
              Cancel
            </Button>
          </form>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Tick: {popover.tick}
          </p>
        </div>
      )}

      {/* Section rename popover */}
      {popover?.kind === 'section-rename' && (
        <div
          className="absolute z-20 rounded-lg border bg-background p-2 shadow-lg"
          style={{left: popover.x + 8, top: popover.y - 16}}>
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSectionRenameSubmit();
            }}
            className="flex items-center gap-1">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Rename:
            </label>
            <Input
              type="text"
              value={sectionNameInput}
              onChange={e => setSectionNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setPopover(null);
                }
              }}
              className="h-7 w-32 text-xs"
              autoFocus
            />
            <Button type="submit" size="sm" className="h-7 px-2 text-xs">
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPopover(null)}>
              Cancel
            </Button>
          </form>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Tick: {popover.tick}
          </p>
        </div>
      )}
    </div>
  );
}
