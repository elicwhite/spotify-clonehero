'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {useChartEditorContext} from './ChartEditorContext';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  AddSectionCommand,
  DeleteSectionCommand,
  RenameSectionCommand,
  MoveSectionCommand,
  noteId,
  typeToLane,
  laneToType,
  defaultFlagsForType,
} from './commands';
import {
  buildTimedTempos,
  tickToMs,
  msToTick,
  snapToGrid,
  getNextGridTick,
} from '@/lib/drum-transcription/timing';
import type {DrumNote} from '@/lib/chart-edit';
import {getDrumNotes} from '@/lib/chart-edit';
import DrumHighwayPreview, {
  type HighwayRendererHandle,
} from './DrumHighwayPreview';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {InteractionManager} from '@/lib/preview/highway';
import type {HitResult} from '@/lib/preview/highway';
import {parseChartFile} from '@eliwhite/scan-chart';
type ParsedChart = ReturnType<typeof parseChartFile>;
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

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
  const {state, dispatch, audioManagerRef, reconcilerRef, noteRendererRef} = useChartEditorContext();
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
  const [hoveredHitType, setHoveredHitType] = useState<'note' | 'section' | 'highway' | null>(null);
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

  // Section drag state
  const [isDraggingSection, setIsDraggingSection] = useState(false);
  const [sectionDragTick, setSectionDragTick] = useState<number | null>(null);
  const [sectionDragName, setSectionDragName] = useState<string>('');
  const [sectionDragOriginalTick, setSectionDragOriginalTick] = useState<number>(0);

  // Double-click tracking for section rename
  const lastClickRef = useRef<{tick: number; time: number} | null>(null);

  // Compute timed tempos for coordinate mapping
  const timedTempos = useMemo(() => {
    if (!state.chartDoc) return [];
    return buildTimedTempos(state.chartDoc.tempos, state.chartDoc.chartTicksPerBeat);
  }, [state.chartDoc]);

  const resolution = state.chartDoc?.chartTicksPerBeat ?? 480;

  // Get the expert drums notes for hit-testing
  const expertNotes = useMemo(() => {
    if (!state.chartDoc) return [];
    const track = state.chartDoc.trackData.find(
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
  }, [rendererVersion, audioData, audioChannels, durationSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Send grid data (tempos + time signatures) to the renderer
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || !state.chartDoc || !durationSeconds) return;
    const tempos = state.chartDoc.tempos.map(t => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
    }));
    const timeSignatures = state.chartDoc.timeSignatures.map(ts => ({
      tick: ts.tick,
      numerator: ts.numerator,
      denominator: ts.denominator,
    }));
    handle.setGridData({
      tempos,
      timeSignatures,
      resolution: state.chartDoc.chartTicksPerBeat,
      durationMs: durationSeconds * 1000,
    });
  }, [rendererVersion, state.chartDoc, durationSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync highway mode from context to renderer
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle) return;
    handle.setHighwayMode(state.highwayMode);
  }, [rendererVersion, state.highwayMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const lane = hit && 'lane' in hit ? hit.lane : screenToLane(coords.x, coords.y);
      const tick = hit ? hit.tick : screenToTick(coords.x, coords.y);

      switch (state.activeTool) {
        case 'cursor': {
          // Check for section hit first
          if (hit?.type === 'section') {
            // Double-click detection for rename
            const now = Date.now();
            const last = lastClickRef.current;
            if (
              last &&
              last.tick === hit.tick &&
              now - last.time < 400
            ) {
              // Double-click: open rename popover
              lastClickRef.current = null;
              setSectionNameInput(hit.name);
              setPopover({
                kind: 'section-rename',
                tick: hit.tick,
                x: coords.x,
                y: coords.y,
              });
              dispatch({type: 'SET_SELECTED_SECTION', tick: hit.tick});
              break;
            }
            lastClickRef.current = {tick: hit.tick, time: now};

            // Select section
            dispatch({type: 'SET_SELECTED_SECTION', tick: hit.tick});
            dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
            // Start section drag
            setIsDraggingSection(true);
            setSectionDragTick(hit.tick);
            setSectionDragName(hit.name);
            setSectionDragOriginalTick(hit.tick);
            setDragStart(coords);
            setDragCurrent(coords);
            break;
          }

          // Clear section selection when clicking elsewhere
          if (state.selectedSectionTick !== null) {
            dispatch({type: 'SET_SELECTED_SECTION', tick: null});
          }

          if (hit?.type === 'note') {
            const id = hit.noteId;
            if (e.shiftKey) {
              // Toggle selection
              const newIds = new Set(state.selectedNoteIds);
              if (newIds.has(id)) {
                newIds.delete(id);
              } else {
                newIds.add(id);
              }
              dispatch({type: 'SET_SELECTED_NOTES', noteIds: newIds});
            } else if (!state.selectedNoteIds.has(id)) {
              // Single select
              dispatch({
                type: 'SET_SELECTED_NOTES',
                noteIds: new Set([id]),
              });
            }
            // Start potential drag-move
            setIsDragging(true);
            setDragStart(coords);
            setDragCurrent(coords);
          } else {
            // Start box selection or deselect
            if (!e.shiftKey) {
              dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
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
            executeCommand(
              new DeleteNotesCommand(new Set([hit.noteId])),
            );
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
            executeCommand(
              new DeleteNotesCommand(new Set([hit.noteId])),
            );
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
      state.activeTool,
      state.selectedNoteIds,
      state.selectedSectionTick,
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
        setHoverLane('lane' in hit ? hit.lane : screenToLane(coords.x, coords.y));
        setHoverTick(hit.tick);
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

      // Section drag: update the visual drag position
      if (isDraggingSection && dragStart) {
        const newTick = screenToTick(coords.x, coords.y);
        setSectionDragTick(newTick);
      }

      // Erase mode: paint-erase while dragging
      if (isErasing && state.activeTool === 'erase') {
        if (hit?.type === 'note') {
          executeCommand(
            new DeleteNotesCommand(new Set([hit.noteId])),
          );
        }
      }
    },
    [
      hitTestAt,
      screenToLane,
      screenToTick,
      dragStart,
      isErasing,
      isDraggingSection,
      state.activeTool,
      executeCommand,
      noteRendererRef,
    ],
  );

  const handleMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const coords = getElementCoords(e);

      if (state.activeTool === 'cursor' && dragStart && dragCurrent) {
        if (isDragging && state.selectedNoteIds.size > 0) {
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
                new MoveNotesCommand(
                  Array.from(state.selectedNoteIds),
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
              const merged = new Set(state.selectedNoteIds);
              selected.forEach(id => merged.add(id));
              dispatch({type: 'SET_SELECTED_NOTES', noteIds: merged});
            } else {
              dispatch({type: 'SET_SELECTED_NOTES', noteIds: selected});
            }
          }
        }
      }

      // Complete section drag-move
      if (isDraggingSection && sectionDragTick !== null && dragStart) {
        const dx = coords.x - dragStart.x;
        const dy = coords.y - dragStart.y;
        if (
          (Math.abs(dx) > 5 || Math.abs(dy) > 5) &&
          sectionDragTick !== sectionDragOriginalTick
        ) {
          executeCommand(
            new MoveSectionCommand(
              sectionDragOriginalTick,
              sectionDragTick,
              sectionDragName,
            ),
          );
          dispatch({type: 'SET_SELECTED_SECTION', tick: sectionDragTick});
        }
      }

      setIsDragging(false);
      setIsDraggingSection(false);
      setSectionDragTick(null);
      setDragStart(null);
      setDragCurrent(null);
      setIsErasing(false);
    },
    [
      state.activeTool,
      state.selectedNoteIds,
      dragStart,
      dragCurrent,
      isDragging,
      isDraggingSection,
      sectionDragTick,
      sectionDragOriginalTick,
      sectionDragName,
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
    if (!isDragging && !isDraggingSection) {
      setDragStart(null);
      setDragCurrent(null);
    }
  }, [isDragging, isDraggingSection, noteRendererRef]);

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

      // Scroll by a fixed time amount per wheel tick (100ms).
      // deltaY < 0 = wheel up = scroll forward, deltaY > 0 = backward.
      const SCROLL_STEP_MS = 25;
      const direction = e.deltaY < 0 ? 1 : -1;
      const currentMs = am.currentTime * 1000;
      const targetMs = Math.max(0, Math.min(currentMs + direction * SCROLL_STEP_MS, am.duration * 1000));

      am.play({time: targetMs / 1000}).then(() => am.pause());

      // Update cursor tick to match
      if (timedTempos.length > 0) {
        const tick = msToTick(targetMs, timedTempos, state.chartDoc.chartTicksPerBeat);
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
    const section = state.chartDoc?.sections.find(
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
      sections: state.chartDoc?.sections ?? [],
      selectedSectionTick: state.selectedSectionTick,
      sectionDrag: isDraggingSection && sectionDragTick !== null
        ? {
            originalTick: sectionDragOriginalTick,
            currentTick: sectionDragTick,
            name: sectionDragName,
          }
        : null,
      loopRegion: state.loopRegion,
    });

    // Push selection and confidence state to the NoteRenderer
    const nr = noteRendererRef.current;
    if (nr) {
      nr.setSelectedNoteIds(state.selectedNoteIds);
      nr.setConfidenceData(
        confidence ?? null,
        showConfidence,
        confidenceThreshold,
      );
      nr.setReviewedNoteIds(reviewedNoteIds ?? null);
    }

    // Push sections to InteractionManager for section hit-testing
    handle.getInteractionManager().then(im => {
      im?.setSections(state.chartDoc?.sections ?? []);
    });
  }, [
    state.cursorTick,
    state.isPlaying,
    state.activeTool,
    state.selectedNoteIds,
    state.selectedSectionTick,
    state.chartDoc?.sections,
    state.loopRegion,
    hoverLane,
    hoverTick,
    isDraggingSection,
    sectionDragTick,
    sectionDragOriginalTick,
    sectionDragName,
    confidence,
    showConfidence,
    confidenceThreshold,
    reviewedNoteIds,
    rendererVersion,
  ]);

  // Push timing data to SceneOverlays when tempos or resolution change
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || timedTempos.length === 0) return;
    handle.setTimingData(timedTempos, resolution);
  }, [timedTempos, resolution]);

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
          : Math.max(
              0,
              snapToGrid(cursorTick, resolution, state.gridDivision),
            );
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
