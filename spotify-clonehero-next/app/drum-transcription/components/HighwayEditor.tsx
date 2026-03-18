'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {useEditorContext, type ToolMode} from '../contexts/EditorContext';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  noteId,
  typeToLane,
  laneToType,
  defaultFlagsForType,
} from '../commands';
import {
  buildTimedTempos,
  msToTick,
  snapToGrid,
} from '@/lib/drum-transcription/chart-io/timing';
import type {
  DrumNote,
  DrumNoteType,
} from '@/lib/drum-transcription/chart-io/types';
import DrumHighwayPreview from './DrumHighwayPreview';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ParsedChart} from '@/lib/drum-transcription/chart-io/reader';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

// ---------------------------------------------------------------------------
// Lane layout constants (must match highway.ts)
// ---------------------------------------------------------------------------

/**
 * The highway renderer uses these constants for drum note placement:
 * - Highway width: 0.9 (createDrumHighway PlaneGeometry width)
 * - NOTE_SPAN_WIDTH = 0.99, SCALE = 0.105
 * - leftOffset for drums = 0.135
 * - Lane X = leftOffset + -(NOTE_SPAN_WIDTH/2) + SCALE + ((NOTE_SPAN_WIDTH - SCALE) / 5) * lane
 *
 * For the 2D overlay, we need to map pixel X to lane index (0-4).
 * The 5 lanes are: 0=Kick, 1=Red, 2=Yellow, 3=Blue, 4=Green
 * We simply divide the canvas width into 5 equal columns.
 */
const NUM_LANES = 5;

// Highway speed matches the renderer constant
const HIGHWAY_SPEED = 1.5;

// Colors for ghost note preview and selection highlights
const LANE_COLORS = [
  'rgba(248, 178, 114, 0.5)', // kick/orange
  'rgba(221, 34, 20, 0.5)', // red
  'rgba(222, 235, 82, 0.5)', // yellow
  'rgba(0, 108, 175, 0.5)', // blue
  'rgba(1, 177, 26, 0.5)', // green
];

const SELECTION_COLOR = 'rgba(255, 255, 255, 0.35)';
const BOX_SELECT_COLOR = 'rgba(100, 149, 237, 0.25)';
const BOX_SELECT_BORDER = 'rgba(100, 149, 237, 0.6)';

interface HighwayEditorProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string;
}

/**
 * Wraps DrumHighwayPreview with an editing overlay canvas.
 *
 * The overlay handles mouse events (click, drag, hover) and draws:
 * - Ghost note preview at cursor position (Place mode)
 * - Selection highlights on selected notes
 * - Box selection rectangle (Cursor mode, drag on empty)
 * - BPM/TimeSig placement indicators
 *
 * All edits go through the command system via useExecuteCommand.
 */
export default function HighwayEditor({
  metadata,
  chart,
  audioManager,
  className,
}: HighwayEditorProps) {
  const {state, dispatch} = useEditorContext();
  const executeCommand = useExecuteCommand();

  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  // Interaction state
  const [hoverLane, setHoverLane] = useState<number | null>(null);
  const [hoverTick, setHoverTick] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{x: number; y: number} | null>(
    null,
  );
  const [dragCurrent, setDragCurrent] = useState<{x: number; y: number} | null>(
    null,
  );
  const [isErasing, setIsErasing] = useState(false);

  // Popover state for BPM/TimeSig editing
  const [popover, setPopover] = useState<{
    kind: 'bpm' | 'timesig';
    tick: number;
    x: number;
    y: number;
  } | null>(null);
  const [bpmInput, setBpmInput] = useState('120');
  const [tsNumerator, setTsNumerator] = useState('4');
  const [tsDenominator, setTsDenominator] = useState('4');

  // Compute timed tempos for coordinate mapping
  const timedTempos = useMemo(() => {
    if (!state.chartDoc) return [];
    return buildTimedTempos(state.chartDoc.tempos, state.chartDoc.resolution);
  }, [state.chartDoc]);

  const resolution = state.chartDoc?.resolution ?? 480;

  // Get the expert drums notes for hit-testing
  const expertNotes = useMemo(() => {
    if (!state.chartDoc) return [];
    const track = state.chartDoc.tracks.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    return track?.notes ?? [];
  }, [state.chartDoc]);

  // ---------------------------------------------------------------------------
  // Coordinate mapping
  // ---------------------------------------------------------------------------

  /** Map pixel X position on the overlay to a lane index (0-4). */
  const xToLane = useCallback(
    (x: number): number => {
      const canvas = overlayRef.current;
      if (!canvas) return 0;
      const laneWidth = canvas.width / NUM_LANES;
      return Math.max(0, Math.min(NUM_LANES - 1, Math.floor(x / laneWidth)));
    },
    [],
  );

  /**
   * Map pixel Y position on the overlay to a tick position.
   *
   * The highway scrolls based on audioManager.currentTime. The hit box
   * (bottom) is at the current time, and notes scroll down toward it.
   * Y=bottom of canvas corresponds to currentTimeMs.
   * Y=top of canvas corresponds to a time further in the future.
   *
   * The highway renderer positions notes at:
   *   notesGroup.position.y = (msTime / 1000) * highwaySpeed - 1
   * And scrolls the group by:
   *   highwayGroups.position.y = -1 * (elapsedTime / 1000) * highwaySpeed
   *
   * For the overlay, we approximate:
   * - The visible range spans roughly 2 seconds of audio
   * - bottom = current time, top = current time + visible window
   */
  const yToMs = useCallback(
    (y: number): number => {
      const canvas = overlayRef.current;
      if (!canvas) return 0;
      const currentMs = state.currentTimeMs;
      // The highway shows ~2.5s of content from bottom to top
      const visibleWindowMs = 2500;
      // Y=0 is top (future), Y=height is bottom (current time)
      const fraction = 1 - y / canvas.height;
      return currentMs + fraction * visibleWindowMs;
    },
    [state.currentTimeMs],
  );

  const yToTick = useCallback(
    (y: number): number => {
      if (timedTempos.length === 0) return 0;
      const ms = yToMs(y);
      const rawTick = msToTick(ms, timedTempos, resolution);
      if (state.gridDivision === 0) return Math.max(0, rawTick);
      return Math.max(0, snapToGrid(rawTick, resolution, state.gridDivision));
    },
    [yToMs, timedTempos, resolution, state.gridDivision],
  );

  /**
   * Reverse: map a tick to a Y pixel position on the overlay canvas.
   */
  const tickToY = useCallback(
    (tick: number): number => {
      const canvas = overlayRef.current;
      if (!canvas || timedTempos.length === 0) return 0;

      // Find the tempo active at this tick
      let tempoIdx = 0;
      for (let i = 1; i < timedTempos.length; i++) {
        if (timedTempos[i].tick <= tick) tempoIdx = i;
        else break;
      }
      const tempo = timedTempos[tempoIdx];
      const ms =
        tempo.msTime +
        ((tick - tempo.tick) * 60000) / (tempo.bpm * resolution);

      const currentMs = state.currentTimeMs;
      const visibleWindowMs = 2500;
      const fraction = (ms - currentMs) / visibleWindowMs;
      return canvas.height * (1 - fraction);
    },
    [timedTempos, resolution, state.currentTimeMs],
  );

  // ---------------------------------------------------------------------------
  // Hit-testing: find note at pixel position
  // ---------------------------------------------------------------------------

  const findNoteAtPosition = useCallback(
    (x: number, y: number): DrumNote | null => {
      const lane = xToLane(x);
      const targetMs = yToMs(y);

      // Find notes within a small time tolerance (~50ms / ~30px)
      const toleranceMs = 80;
      const targetType = laneToType(lane);

      for (const note of expertNotes) {
        if (note.type !== targetType) continue;
        // Convert note tick to ms for comparison
        let tempoIdx = 0;
        for (let i = 1; i < timedTempos.length; i++) {
          if (timedTempos[i].tick <= note.tick) tempoIdx = i;
          else break;
        }
        const tempo = timedTempos[tempoIdx];
        const noteMs =
          tempo.msTime +
          ((note.tick - tempo.tick) * 60000) / (tempo.bpm * resolution);

        if (Math.abs(noteMs - targetMs) <= toleranceMs) {
          return note;
        }
      }
      return null;
    },
    [xToLane, yToMs, expertNotes, timedTempos, resolution],
  );

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  const getCanvasCoords = (e: ReactMouseEvent<HTMLCanvasElement>): {x: number; y: number} => {
    const canvas = overlayRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const coords = getCanvasCoords(e);
      const lane = xToLane(coords.x);
      const tick = yToTick(coords.y);

      switch (state.activeTool) {
        case 'cursor': {
          const hitNote = findNoteAtPosition(coords.x, coords.y);
          if (hitNote) {
            const id = noteId(hitNote);
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
          const existing = expertNotes.find(
            n => n.tick === tick && n.type === type,
          );
          if (existing) {
            executeCommand(
              new DeleteNotesCommand(new Set([noteId(existing)])),
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
          const hitNote = findNoteAtPosition(coords.x, coords.y);
          if (hitNote) {
            executeCommand(
              new DeleteNotesCommand(new Set([noteId(hitNote)])),
            );
          }
          setIsErasing(true);
          break;
        }
        case 'bpm': {
          const rect = overlayRef.current!.getBoundingClientRect();
          setPopover({
            kind: 'bpm',
            tick,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
          // Pre-fill with current BPM at this position
          if (timedTempos.length > 0) {
            let idx = 0;
            for (let i = 1; i < timedTempos.length; i++) {
              if (timedTempos[i].tick <= tick) idx = i;
              else break;
            }
            setBpmInput(String(timedTempos[idx].bpm));
          }
          break;
        }
        case 'timesig': {
          const rect2 = overlayRef.current!.getBoundingClientRect();
          setPopover({
            kind: 'timesig',
            tick,
            x: e.clientX - rect2.left,
            y: e.clientY - rect2.top,
          });
          setTsNumerator('4');
          setTsDenominator('4');
          break;
        }
      }
    },
    [
      state.activeTool,
      state.selectedNoteIds,
      xToLane,
      yToTick,
      findNoteAtPosition,
      expertNotes,
      timedTempos,
      executeCommand,
      dispatch,
    ],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const coords = getCanvasCoords(e);
      setHoverLane(xToLane(coords.x));
      setHoverTick(yToTick(coords.y));

      if (dragStart) {
        setDragCurrent(coords);
      }

      // Erase mode: paint-erase while dragging
      if (isErasing && state.activeTool === 'erase') {
        const hitNote = findNoteAtPosition(coords.x, coords.y);
        if (hitNote) {
          executeCommand(
            new DeleteNotesCommand(new Set([noteId(hitNote)])),
          );
        }
      }
    },
    [
      xToLane,
      yToTick,
      dragStart,
      isErasing,
      state.activeTool,
      findNoteAtPosition,
      executeCommand,
    ],
  );

  const handleMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const coords = getCanvasCoords(e);

      if (state.activeTool === 'cursor' && dragStart && dragCurrent) {
        if (isDragging && state.selectedNoteIds.size > 0) {
          // Complete drag-move
          const dx = coords.x - dragStart.x;
          const dy = coords.y - dragStart.y;
          // Only apply if moved more than a small threshold
          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            const laneDelta =
              xToLane(coords.x) - xToLane(dragStart.x);
            const startTick = yToTick(dragStart.y);
            const endTick = yToTick(coords.y);
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
            const ms1 = yToMs(y2); // y2 is lower on screen = earlier time
            const ms2 = yToMs(y1); // y1 is higher on screen = later time
            const lane1 = xToLane(x1);
            const lane2 = xToLane(x2);

            const selected = new Set<string>();
            for (const note of expertNotes) {
              const noteLane = typeToLane(note.type);
              if (noteLane < lane1 || noteLane > lane2) continue;

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
                  (tempo.bpm * resolution);

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

      setIsDragging(false);
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
      xToLane,
      yToTick,
      yToMs,
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
    setIsErasing(false);
    if (!isDragging) {
      setDragStart(null);
      setDragCurrent(null);
    }
  }, [isDragging]);

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

  // ---------------------------------------------------------------------------
  // Overlay rendering loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    function draw() {
      const ctx = canvas!.getContext('2d');
      if (!ctx) return;

      const w = canvas!.width;
      const h = canvas!.height;
      ctx.clearRect(0, 0, w, h);

      const laneWidth = w / NUM_LANES;

      // Draw lane dividers (subtle)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      for (let i = 1; i < NUM_LANES; i++) {
        const x = i * laneWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Draw selection highlights
      if (state.selectedNoteIds.size > 0) {
        for (const note of expertNotes) {
          if (!state.selectedNoteIds.has(noteId(note))) continue;
          const lane = typeToLane(note.type);
          const y = tickToY(note.tick);
          if (y < -20 || y > h + 20) continue;

          ctx.fillStyle = SELECTION_COLOR;
          ctx.fillRect(
            lane * laneWidth + 2,
            y - 8,
            laneWidth - 4,
            16,
          );
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(
            lane * laneWidth + 2,
            y - 8,
            laneWidth - 4,
            16,
          );
        }
      }

      // Draw ghost note preview (Place mode)
      if (
        state.activeTool === 'place' &&
        hoverLane !== null &&
        hoverTick !== null
      ) {
        const y = tickToY(hoverTick);
        if (y > 0 && y < h) {
          ctx.fillStyle = LANE_COLORS[hoverLane];
          ctx.beginPath();
          ctx.ellipse(
            hoverLane * laneWidth + laneWidth / 2,
            y,
            laneWidth / 3,
            6,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }

      // Draw box selection rectangle (Cursor mode)
      if (
        state.activeTool === 'cursor' &&
        dragStart &&
        dragCurrent &&
        !isDragging
      ) {
        const x1 = Math.min(dragStart.x, dragCurrent.x);
        const y1 = Math.min(dragStart.y, dragCurrent.y);
        const bw = Math.abs(dragCurrent.x - dragStart.x);
        const bh = Math.abs(dragCurrent.y - dragStart.y);
        if (bw > 3 || bh > 3) {
          ctx.fillStyle = BOX_SELECT_COLOR;
          ctx.fillRect(x1, y1, bw, bh);
          ctx.strokeStyle = BOX_SELECT_BORDER;
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, y1, bw, bh);
        }
      }

      // Draw hover highlight for eraser
      if (state.activeTool === 'erase' && hoverLane !== null) {
        const canvas2 = overlayRef.current;
        if (canvas2) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
          ctx.fillRect(
            hoverLane * laneWidth,
            0,
            laneWidth,
            h,
          );
        }
      }

      // Draw cursor crosshair for BPM/TimeSig modes
      if (
        (state.activeTool === 'bpm' || state.activeTool === 'timesig') &&
        hoverTick !== null
      ) {
        const y = tickToY(hoverTick);
        if (y > 0 && y < h) {
          ctx.strokeStyle =
            state.activeTool === 'bpm'
              ? 'rgba(255, 165, 0, 0.7)'
              : 'rgba(147, 112, 219, 0.7)';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Label
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = '11px monospace';
          ctx.fillText(
            state.activeTool === 'bpm'
              ? `BPM @ tick ${hoverTick}`
              : `TS @ tick ${hoverTick}`,
            4,
            y - 6,
          );
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [
    state.activeTool,
    state.selectedNoteIds,
    hoverLane,
    hoverTick,
    dragStart,
    dragCurrent,
    isDragging,
    expertNotes,
    tickToY,
  ]);

  // ---------------------------------------------------------------------------
  // Resize observer to keep overlay canvas sized to container
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    const canvas = overlayRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
    });
    observer.observe(container);

    // Initial size
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;

    return () => observer.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // Cursor style based on tool mode
  // ---------------------------------------------------------------------------

  const cursorStyle = useMemo(() => {
    switch (state.activeTool) {
      case 'cursor':
        return 'default';
      case 'place':
        return 'crosshair';
      case 'erase':
        return 'pointer';
      case 'bpm':
      case 'timesig':
        return 'crosshair';
      default:
        return 'default';
    }
  }, [state.activeTool]);

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
      />

      {/* Transparent overlay canvas for editing interactions */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 z-10"
        style={{cursor: cursorStyle}}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

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
    </div>
  );
}
