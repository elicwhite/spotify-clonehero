'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import * as THREE from 'three';
import {useChartEditorContext, type ToolMode} from './ChartEditorContext';
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
  msToTick,
  tickToMs,
  snapToGrid,
} from '@/lib/drum-transcription/timing';
import type {
  DrumNote,
  DrumNoteType,
} from '@/lib/chart-edit';
import {getDrumNotes} from '@/lib/chart-edit';
import DrumHighwayPreview, {
  type HighwayRendererHandle,
} from './DrumHighwayPreview';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import {parseChartFile} from '@eliwhite/scan-chart';
type ParsedChart = ReturnType<typeof parseChartFile>;
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

// ---------------------------------------------------------------------------
// Lane layout constants (must match highway.ts)
// ---------------------------------------------------------------------------

const NUM_LANES = 5;
const SCALE = 0.105;
const NOTE_SPAN_WIDTH = 0.99;

/**
 * Compute the 3D X positions for each drum lane as rendered by highway.ts.
 *
 * highway.ts calculateNoteXOffset('drums', lane) uses lanes 0-3 for
 * red/yellow/blue/green. Kick is rendered centered at x=0.
 *
 * Our editor lanes are 0=kick, 1=red, 2=yellow, 3=blue, 4=green.
 * We compute the 3D X center for each editor lane.
 */
function computeLaneXPositions(): number[] {
  const leftOffset = 0.135;
  // Kick is centered at x=0
  const kickX = 0;
  // Lanes 0-3 in highway.ts correspond to red(1), yellow(2), blue(3), green(4) in editor
  const positions = [kickX];
  for (let hwLane = 0; hwLane < 4; hwLane++) {
    const x =
      leftOffset +
      -(NOTE_SPAN_WIDTH / 2) +
      SCALE +
      ((NOTE_SPAN_WIDTH - SCALE) / 5) * hwLane;
    positions.push(x);
  }
  return positions;
}

const LANE_X_POSITIONS = computeLaneXPositions();

/**
 * The lane boundaries (midpoints between adjacent lane centers) for hit testing.
 * A click at 3D x is in lane i if x is between LANE_BOUNDARIES[i] and LANE_BOUNDARIES[i+1].
 */
function computeLaneBoundaries(): number[] {
  // Sort lanes by X position for boundary computation
  // Lanes: kick(0)=0, red(1)=-0.255, yellow(2)=-0.078, blue(3)=0.099, green(4)=0.276
  // Sorted by X: red(-0.255), yellow(-0.078), kick(0), blue(0.099), green(0.276)
  //
  // But we want to map based on the editor lane order (0-4).
  // Since kick is at the center and the other notes are spread across,
  // we need to find which lane a given X is closest to.
  //
  // For simplicity and accuracy, we'll find the closest lane center to the
  // clicked X position.
  // Return sorted pairs of [x, laneIndex] for boundary-based lookup.
  const sorted = LANE_X_POSITIONS.map((x, i) => ({x, lane: i})).sort(
    (a, b) => a.x - b.x,
  );

  // Boundaries between sorted lanes
  const boundaries: number[] = [-Infinity];
  for (let i = 1; i < sorted.length; i++) {
    boundaries.push((sorted[i - 1].x + sorted[i].x) / 2);
  }
  boundaries.push(Infinity);

  return boundaries;
}

/** Find the lane index (0-4) for a 3D X coordinate. */
function xWorldToLane(worldX: number): number {
  // Find the closest lane center
  let bestLane = 0;
  let bestDist = Infinity;
  for (let i = 0; i < LANE_X_POSITIONS.length; i++) {
    const dist = Math.abs(worldX - LANE_X_POSITIONS[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestLane = i;
    }
  }
  return bestLane;
}

// Highway width is 0.9, half-width is 0.45
const HIGHWAY_HALF_WIDTH = 0.45;

/** Check if a 3D X coordinate is within the highway bounds. */
function isOnHighway(worldX: number): boolean {
  return Math.abs(worldX) <= HIGHWAY_HALF_WIDTH + 0.05; // small margin
}

// Colors for ghost note preview and selection highlights
const LANE_COLORS = [
  'rgba(248, 178, 114, 0.5)', // kick/orange
  'rgba(221, 34, 20, 0.5)', // red
  'rgba(222, 235, 82, 0.5)', // yellow
  'rgba(0, 108, 175, 0.5)', // blue
  'rgba(1, 177, 26, 0.5)', // green
];

// Ghost note colors for cursor position (fainter than hover ghost)
const GHOST_LANE_COLORS = [
  'rgba(248, 178, 114, 0.25)', // kick/orange
  'rgba(221, 34, 20, 0.25)', // red
  'rgba(222, 235, 82, 0.25)', // yellow
  'rgba(0, 108, 175, 0.25)', // blue
  'rgba(1, 177, 26, 0.25)', // green
];

const CURSOR_LINE_COLOR = 'rgba(0, 255, 128, 0.8)';
const CURSOR_LINE_WIDTH = 2.5;

const SELECTION_COLOR = 'rgba(255, 255, 255, 0.35)';
const BOX_SELECT_COLOR = 'rgba(100, 149, 237, 0.25)';
const BOX_SELECT_BORDER = 'rgba(100, 149, 237, 0.6)';

// Section banner constants
const SECTION_BG_COLOR = 'rgba(255, 200, 0, 0.15)';
const SECTION_TEXT_COLOR = 'rgba(255, 200, 0, 0.9)';
const SECTION_LINE_COLOR = 'rgba(255, 200, 0, 0.5)';
const SECTION_SELECTED_BG = 'rgba(255, 200, 0, 0.35)';
const SECTION_SELECTED_BORDER = 'rgba(255, 200, 0, 0.8)';
const SECTION_BANNER_HEIGHT = 24;
const SECTION_HIT_TOLERANCE_PX = 14;

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
}

// ---------------------------------------------------------------------------
// Unprojection helper: screen pixel → 3D world point on the highway plane
// ---------------------------------------------------------------------------

/**
 * Unproject a screen-space pixel coordinate to a 3D point on the highway
 * plane (z=0) using the Three.js camera.
 *
 * Returns null if the ray doesn't intersect the plane (shouldn't happen
 * with the highway camera setup, but defensive).
 */
function screenToWorld(
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
  camera: THREE.PerspectiveCamera,
): THREE.Vector3 | null {
  // Convert pixel coords to NDC (-1 to +1)
  const ndcX = (screenX / canvasWidth) * 2 - 1;
  const ndcY = -(screenY / canvasHeight) * 2 + 1;

  // Create ray from camera through NDC point
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  // Intersect with highway plane (z=0)
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const intersection = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(plane, intersection);

  return hit;
}

/**
 * Project a 3D world point on the highway plane back to screen-space pixels.
 */
function worldToScreen(
  worldPoint: THREE.Vector3,
  canvasWidth: number,
  canvasHeight: number,
  camera: THREE.PerspectiveCamera,
): {x: number; y: number} {
  const projected = worldPoint.clone().project(camera);
  return {
    x: ((projected.x + 1) / 2) * canvasWidth,
    y: ((-projected.y + 1) / 2) * canvasHeight,
  };
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
 *
 * Coordinate mapping uses Three.js unprojection through the same camera
 * that the highway renderer uses, ensuring the overlay lanes and tick
 * positions exactly match the 3D rendered notes even with perspective.
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
}: HighwayEditorProps) {
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const executeCommand = useExecuteCommand();

  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  // Three.js renderer handle for coordinate mapping
  const rendererHandleRef = useRef<HighwayRendererHandle | null>(null);

  const handleRendererReady = useCallback(
    (handle: HighwayRendererHandle | null) => {
      rendererHandleRef.current = handle;
    },
    [],
  );

  // Interaction state
  const [hoverLane, setHoverLane] = useState<number | null>(null);
  const [hoverTick, setHoverTick] = useState<number | null>(null);
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
  // Coordinate mapping via Three.js unprojection
  //
  // These functions convert screen pixel positions to lane/tick by
  // unprojecting through the Three.js camera to find the 3D intersection
  // with the highway plane, then mapping the 3D coordinates.
  //
  // IMPORTANT: These read audioManager.currentTime directly (not React
  // state) so they don't need to be recreated when time changes.
  // ---------------------------------------------------------------------------

  /** Map pixel X,Y position on the overlay to a lane index (0-4). */
  const screenToLane = useCallback((x: number, y: number): number => {
    const canvas = overlayRef.current;
    const handle = rendererHandleRef.current;
    if (!canvas || !handle) return 0;

    const camera = handle.getCamera();
    const world = screenToWorld(x, y, canvas.width, canvas.height, camera);
    if (!world) return 0;

    return xWorldToLane(world.x);
  }, []);

  /**
   * Map pixel X,Y position on the overlay to a ms timestamp.
   *
   * Uses Three.js unprojection to find the 3D Y coordinate on the highway
   * plane, then converts to ms using the highway speed and current scroll.
   */
  const screenToMs = useCallback(
    (x: number, y: number): number => {
      const canvas = overlayRef.current;
      const handle = rendererHandleRef.current;
      if (!canvas || !handle) return 0;

      const camera = handle.getCamera();
      const highwaySpeed = handle.getHighwaySpeed();
      const world = screenToWorld(x, y, canvas.width, canvas.height, camera);
      if (!world) return 0;

      // world.y = ((noteMs - elapsedMs) / 1000) * highwaySpeed - 1
      // Solve for noteMs:
      // noteMs = ((world.y + 1) / highwaySpeed) * 1000 + elapsedMs
      const currentMs = audioManager.currentTime * 1000;
      const delay = (audioManager.delay || 0) * 1000;
      const elapsedMs = currentMs - delay;

      return ((world.y + 1) / highwaySpeed) * 1000 + elapsedMs;
    },
    [audioManager],
  );

  const screenToTick = useCallback(
    (x: number, y: number): number => {
      if (timedTempos.length === 0) return 0;
      const ms = screenToMs(x, y);
      const rawTick = msToTick(ms, timedTempos, resolution);
      if (state.gridDivision === 0) return Math.max(0, rawTick);
      return Math.max(0, snapToGrid(rawTick, resolution, state.gridDivision));
    },
    [screenToMs, timedTempos, resolution, state.gridDivision],
  );

  /**
   * Reverse: map a tick and lane to screen-space pixel position.
   *
   * Uses Three.js projection through the camera so the overlay
   * rendering matches the 3D highway exactly.
   */
  const noteToScreen = useCallback(
    (
      tick: number,
      lane: number,
    ): {x: number; y: number} => {
      const canvas = overlayRef.current;
      const handle = rendererHandleRef.current;
      if (!canvas || !handle || timedTempos.length === 0)
        return {x: 0, y: 0};

      const camera = handle.getCamera();
      const highwaySpeed = handle.getHighwaySpeed();

      // Convert tick to ms
      let tempoIdx = 0;
      for (let i = 1; i < timedTempos.length; i++) {
        if (timedTempos[i].tick <= tick) tempoIdx = i;
        else break;
      }
      const tempo = timedTempos[tempoIdx];
      const ms =
        tempo.msTime +
        ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * resolution);

      // Compute world Y
      const currentMs = audioManager.currentTime * 1000;
      const delay = (audioManager.delay || 0) * 1000;
      const elapsedMs = currentMs - delay;
      const worldY = ((ms - elapsedMs) / 1000) * highwaySpeed - 1;

      // Get world X for lane
      const worldX = LANE_X_POSITIONS[lane] ?? 0;

      // Project to screen
      const worldPoint = new THREE.Vector3(worldX, worldY, 0);
      return worldToScreen(worldPoint, canvas.width, canvas.height, camera);
    },
    [timedTempos, resolution, audioManager],
  );

  // ---------------------------------------------------------------------------
  // Hit-testing: find note at pixel position
  // ---------------------------------------------------------------------------

  const findNoteAtPosition = useCallback(
    (x: number, y: number): DrumNote | null => {
      const lane = screenToLane(x, y);
      const targetMs = screenToMs(x, y);

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
          ((note.tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * resolution);

        if (Math.abs(noteMs - targetMs) <= toleranceMs) {
          return note;
        }
      }
      return null;
    },
    [screenToLane, screenToMs, expertNotes, timedTempos, resolution],
  );

  /**
   * Find a section whose banner intersects the given screen position.
   * Returns the section {tick, name} or null.
   */
  const findSectionAtPosition = useCallback(
    (x: number, y: number): {tick: number; name: string} | null => {
      if (!state.chartDoc) return null;
      const sections = state.chartDoc.sections;
      if (sections.length === 0) return null;

      const handle = rendererHandleRef.current;
      const canvas = overlayRef.current;
      if (!handle || !canvas) return null;

      const camera = handle.getCamera();
      const highwaySpeed = handle.getHighwaySpeed();
      const currentMs = audioManager.currentTime * 1000;
      const delay = (audioManager.delay || 0) * 1000;
      const elapsedMs = currentMs - delay;
      const w = canvas.width;
      const h = canvas.height;

      for (const section of sections) {
        // Convert section tick to ms
        let tempoIdx = 0;
        for (let i = 1; i < timedTempos.length; i++) {
          if (timedTempos[i].tick <= section.tick) tempoIdx = i;
          else break;
        }
        const tempo = timedTempos[tempoIdx];
        const ms =
          tempo.msTime +
          ((section.tick - tempo.tick) * 60000) /
            (tempo.beatsPerMinute * resolution);

        const worldY = ((ms - elapsedMs) / 1000) * highwaySpeed - 1;
        const worldPoint = new THREE.Vector3(0, worldY, 0);
        const screenPt = worldToScreen(worldPoint, w, h, camera);

        if (
          Math.abs(screenPt.y - y) <= SECTION_HIT_TOLERANCE_PX &&
          screenPt.y > 0 &&
          screenPt.y < h
        ) {
          return section;
        }
      }
      return null;
    },
    [state.chartDoc, timedTempos, resolution, audioManager],
  );

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  const getCanvasCoords = (
    e: ReactMouseEvent<HTMLCanvasElement>,
  ): {x: number; y: number} => {
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
      const lane = screenToLane(coords.x, coords.y);
      const tick = screenToTick(coords.x, coords.y);

      switch (state.activeTool) {
        case 'cursor': {
          // Check for section hit first
          const hitSection = findSectionAtPosition(coords.x, coords.y);
          if (hitSection) {
            // Double-click detection for rename
            const now = Date.now();
            const last = lastClickRef.current;
            if (
              last &&
              last.tick === hitSection.tick &&
              now - last.time < 400
            ) {
              // Double-click: open rename popover
              lastClickRef.current = null;
              const rect = overlayRef.current!.getBoundingClientRect();
              setSectionNameInput(hitSection.name);
              setPopover({
                kind: 'section-rename',
                tick: hitSection.tick,
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
              });
              dispatch({type: 'SET_SELECTED_SECTION', tick: hitSection.tick});
              break;
            }
            lastClickRef.current = {tick: hitSection.tick, time: now};

            // Select section
            dispatch({type: 'SET_SELECTED_SECTION', tick: hitSection.tick});
            dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
            // Start section drag
            setIsDraggingSection(true);
            setSectionDragTick(hitSection.tick);
            setSectionDragName(hitSection.name);
            setSectionDragOriginalTick(hitSection.tick);
            setDragStart(coords);
            setDragCurrent(coords);
            break;
          }

          // Clear section selection when clicking elsewhere
          if (state.selectedSectionTick !== null) {
            dispatch({type: 'SET_SELECTED_SECTION', tick: null});
          }

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
            setBpmInput(String(timedTempos[idx].beatsPerMinute));
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
        case 'section': {
          const rect3 = overlayRef.current!.getBoundingClientRect();
          setSectionNameInput('');
          setPopover({
            kind: 'section',
            tick,
            x: e.clientX - rect3.left,
            y: e.clientY - rect3.top,
          });
          break;
        }
      }
    },
    [
      state.activeTool,
      state.selectedNoteIds,
      state.selectedSectionTick,
      screenToLane,
      screenToTick,
      findNoteAtPosition,
      findSectionAtPosition,
      expertNotes,
      timedTempos,
      executeCommand,
      dispatch,
    ],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const coords = getCanvasCoords(e);
      setHoverLane(screenToLane(coords.x, coords.y));
      setHoverTick(screenToTick(coords.x, coords.y));

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
        const hitNote = findNoteAtPosition(coords.x, coords.y);
        if (hitNote) {
          executeCommand(
            new DeleteNotesCommand(new Set([noteId(hitNote)])),
          );
        }
      }
    },
    [
      screenToLane,
      screenToTick,
      dragStart,
      isErasing,
      isDraggingSection,
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
    setIsErasing(false);
    if (!isDragging && !isDraggingSection) {
      setDragStart(null);
      setDragCurrent(null);
    }
  }, [isDragging, isDraggingSection]);

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
  // Refs that mirror state for use inside the draw loop.
  // ---------------------------------------------------------------------------

  const stateRef = useRef(state);
  stateRef.current = state;

  // Refs for optional confidence/review props (read from animation frame)
  const confidenceRef = useRef(confidence);
  confidenceRef.current = confidence;
  const showConfidenceRef = useRef(showConfidence);
  showConfidenceRef.current = showConfidence;
  const confidenceThresholdRef = useRef(confidenceThreshold);
  confidenceThresholdRef.current = confidenceThreshold;
  const reviewedNoteIdsRef = useRef(reviewedNoteIds);
  reviewedNoteIdsRef.current = reviewedNoteIds;

  const hoverLaneRef = useRef(hoverLane);
  hoverLaneRef.current = hoverLane;

  const hoverTickRef = useRef(hoverTick);
  hoverTickRef.current = hoverTick;

  const dragStartRef = useRef(dragStart);
  dragStartRef.current = dragStart;

  const dragCurrentRef = useRef(dragCurrent);
  dragCurrentRef.current = dragCurrent;

  const isDraggingRef = useRef(isDragging);
  isDraggingRef.current = isDragging;

  const expertNotesRef = useRef(expertNotes);
  expertNotesRef.current = expertNotes;

  const timedTemposRef = useRef(timedTempos);
  timedTemposRef.current = timedTempos;

  const resolutionRef = useRef(resolution);
  resolutionRef.current = resolution;

  const isDraggingSectionRef = useRef(isDraggingSection);
  isDraggingSectionRef.current = isDraggingSection;
  const sectionDragTickRef = useRef(sectionDragTick);
  sectionDragTickRef.current = sectionDragTick;
  const sectionDragNameRef = useRef(sectionDragName);
  sectionDragNameRef.current = sectionDragName;
  const sectionDragOriginalTickRef = useRef(sectionDragOriginalTick);
  sectionDragOriginalTickRef.current = sectionDragOriginalTick;

  // ---------------------------------------------------------------------------
  // Overlay rendering loop
  //
  // This runs a single requestAnimationFrame loop for the lifetime of the
  // component. It reads all needed values from refs (synced above) and
  // audioManager.currentTime directly, so it never needs to be torn down
  // and restarted due to state changes.
  //
  // Drawing uses Three.js projection (worldToScreen) to position overlay
  // elements exactly where the 3D notes appear.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    function draw() {
      const ctx = canvas!.getContext('2d');
      if (!ctx) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Read all values from refs (no React dependency tracking)
      const st = stateRef.current;
      const curHoverLane = hoverLaneRef.current;
      const curHoverTick = hoverTickRef.current;
      const curDragStart = dragStartRef.current;
      const curDragCurrent = dragCurrentRef.current;
      const curIsDragging = isDraggingRef.current;
      const notes = expertNotesRef.current;
      const tempos = timedTemposRef.current;
      const res = resolutionRef.current;
      const handle = rendererHandleRef.current;

      const w = canvas!.width;
      const h = canvas!.height;
      ctx.clearRect(0, 0, w, h);

      // Helper: project a note (tick + lane) to screen using the camera
      function localNoteToScreen(
        tick: number,
        lane: number,
      ): {x: number; y: number} | null {
        if (!handle || tempos.length === 0) return null;

        const camera = handle.getCamera();
        const highwaySpeed = handle.getHighwaySpeed();
        const currentMs = audioManager.currentTime * 1000;
        const delay = (audioManager.delay || 0) * 1000;
        const elapsedMs = currentMs - delay;

        // tick to ms
        let tempoIdx = 0;
        for (let i = 1; i < tempos.length; i++) {
          if (tempos[i].tick <= tick) tempoIdx = i;
          else break;
        }
        const tempo = tempos[tempoIdx];
        const ms =
          tempo.msTime +
          ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * res);

        const worldY = ((ms - elapsedMs) / 1000) * highwaySpeed - 1;
        const worldX = LANE_X_POSITIONS[lane] ?? 0;
        const worldPoint = new THREE.Vector3(worldX, worldY, 0);
        return worldToScreen(worldPoint, w, h, camera);
      }

      // Helper: project a ms time to a screen Y at the center of the highway
      function msToScreenY(ms: number): number | null {
        if (!handle) return null;
        const camera = handle.getCamera();
        const highwaySpeed = handle.getHighwaySpeed();
        const currentMs = audioManager.currentTime * 1000;
        const delay = (audioManager.delay || 0) * 1000;
        const elapsedMs = currentMs - delay;
        const worldY = ((ms - elapsedMs) / 1000) * highwaySpeed - 1;
        const worldPoint = new THREE.Vector3(0, worldY, 0);
        const screen = worldToScreen(worldPoint, w, h, camera);
        return screen.y;
      }

      // Helper: get the screen X range for a lane at a given screen Y
      function laneScreenBounds(
        lane: number,
        screenY: number,
      ): {left: number; right: number; cx: number; width: number} | null {
        if (!handle) return null;
        const camera = handle.getCamera();
        const laneX = LANE_X_POSITIONS[lane] ?? 0;
        const highwaySpeed = handle.getHighwaySpeed();
        const currentMs = audioManager.currentTime * 1000;
        const delay = (audioManager.delay || 0) * 1000;
        const elapsedMs = currentMs - delay;

        // We need the worldY that corresponds to this screenY.
        // Unproject from screen to world.
        const world = screenToWorld(
          w / 2,
          screenY,
          w,
          h,
          camera,
        );
        if (!world) return null;
        const worldY = world.y;

        // Compute lane center and boundaries in screen space at this worldY
        const centerScreen = worldToScreen(
          new THREE.Vector3(laneX, worldY, 0),
          w,
          h,
          camera,
        );

        // Compute half-lane width: distance to midpoint between this lane and neighbors
        let leftBoundX: number, rightBoundX: number;
        const sortedLanes = LANE_X_POSITIONS.slice().sort((a, b) => a - b);
        const sortedIdx = sortedLanes.indexOf(laneX);

        if (sortedIdx === 0) {
          leftBoundX = -HIGHWAY_HALF_WIDTH;
        } else {
          leftBoundX = (sortedLanes[sortedIdx - 1] + laneX) / 2;
        }
        if (sortedIdx === sortedLanes.length - 1) {
          rightBoundX = HIGHWAY_HALF_WIDTH;
        } else {
          rightBoundX = (laneX + sortedLanes[sortedIdx + 1]) / 2;
        }

        const leftScreen = worldToScreen(
          new THREE.Vector3(leftBoundX, worldY, 0),
          w,
          h,
          camera,
        );
        const rightScreen = worldToScreen(
          new THREE.Vector3(rightBoundX, worldY, 0),
          w,
          h,
          camera,
        );

        return {
          left: leftScreen.x,
          right: rightScreen.x,
          cx: centerScreen.x,
          width: rightScreen.x - leftScreen.x,
        };
      }

      // Draw lane dividers using projected positions
      if (handle) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;

        // Draw dividers at top and bottom, connecting with lines
        const sortedLaneXs = LANE_X_POSITIONS.slice().sort((a, b) => a - b);
        for (let i = 0; i < sortedLaneXs.length - 1; i++) {
          const boundaryX = (sortedLaneXs[i] + sortedLaneXs[i + 1]) / 2;

          // Project at top and bottom of visible highway
          const camera = handle.getCamera();
          const topScreen = worldToScreen(
            new THREE.Vector3(boundaryX, 2, 0),
            w,
            h,
            camera,
          );
          const bottomScreen = worldToScreen(
            new THREE.Vector3(boundaryX, -1.5, 0),
            w,
            h,
            camera,
          );

          ctx.beginPath();
          ctx.moveTo(topScreen.x, topScreen.y);
          ctx.lineTo(bottomScreen.x, bottomScreen.y);
          ctx.stroke();
        }
      }

      // Draw section banners
      if (st.chartDoc && handle) {
        const camera = handle.getCamera();
        const highwaySpeed = handle.getHighwaySpeed();
        const currentMs = audioManager.currentTime * 1000;
        const delay = (audioManager.delay || 0) * 1000;
        const elapsedMs = currentMs - delay;
        const curDraggingSection = isDraggingSectionRef.current;
        const curDragSectionTick = sectionDragTickRef.current;
        const curDragSectionName = sectionDragNameRef.current;
        const curDragSectionOrigTick = sectionDragOriginalTickRef.current;

        const sectionsToRender = st.chartDoc.sections;
        for (const section of sectionsToRender) {
          // During a drag, hide the section at its original tick
          // (we'll draw it at the drag position instead)
          if (
            curDraggingSection &&
            section.tick === curDragSectionOrigTick
          ) {
            continue;
          }

          let sTempoIdx = 0;
          for (let i = 1; i < tempos.length; i++) {
            if (tempos[i].tick <= section.tick) sTempoIdx = i;
            else break;
          }
          const sTempo = tempos[sTempoIdx];
          const sMs =
            sTempo.msTime +
            ((section.tick - sTempo.tick) * 60000) /
              (sTempo.beatsPerMinute * res);
          const sWorldY = ((sMs - elapsedMs) / 1000) * highwaySpeed - 1;

          // Clip to visible highway range (world Y: -1 to ~1.1)
          if (sWorldY > 1.1 || sWorldY < -1.2) continue;

          const leftPt = worldToScreen(
            new THREE.Vector3(-HIGHWAY_HALF_WIDTH, sWorldY, 0),
            w,
            h,
            camera,
          );
          const rightPt = worldToScreen(
            new THREE.Vector3(HIGHWAY_HALF_WIDTH, sWorldY, 0),
            w,
            h,
            camera,
          );

          if (leftPt.y < -20 || leftPt.y > h + 20) continue;

          const isSelected = st.selectedSectionTick === section.tick;
          const bannerH = SECTION_BANNER_HEIGHT;
          const bannerW = rightPt.x - leftPt.x;

          // Draw banner background
          ctx.fillStyle = isSelected ? SECTION_SELECTED_BG : SECTION_BG_COLOR;
          ctx.fillRect(leftPt.x, leftPt.y - bannerH / 2, bannerW, bannerH);

          // Draw border for selected section
          if (isSelected) {
            ctx.strokeStyle = SECTION_SELECTED_BORDER;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(leftPt.x, leftPt.y - bannerH / 2, bannerW, bannerH);
          }

          // Draw line
          ctx.strokeStyle = SECTION_LINE_COLOR;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(leftPt.x, leftPt.y);
          ctx.lineTo(rightPt.x, rightPt.y);
          ctx.stroke();

          // Draw text
          ctx.fillStyle = SECTION_TEXT_COLOR;
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(section.name, leftPt.x + 8, leftPt.y);
        }

        // Draw section being dragged at its current drag position
        if (
          curDraggingSection &&
          curDragSectionTick !== null
        ) {
          let dTempoIdx = 0;
          for (let i = 1; i < tempos.length; i++) {
            if (tempos[i].tick <= curDragSectionTick) dTempoIdx = i;
            else break;
          }
          const dTempo = tempos[dTempoIdx];
          const dMs =
            dTempo.msTime +
            ((curDragSectionTick - dTempo.tick) * 60000) /
              (dTempo.beatsPerMinute * res);
          const dWorldY = ((dMs - elapsedMs) / 1000) * highwaySpeed - 1;

          // Clip to visible highway range
          if (dWorldY <= 1.1 && dWorldY >= -1.2) {
          const dLeftPt = worldToScreen(
            new THREE.Vector3(-HIGHWAY_HALF_WIDTH, dWorldY, 0),
            w,
            h,
            camera,
          );
          const dRightPt = worldToScreen(
            new THREE.Vector3(HIGHWAY_HALF_WIDTH, dWorldY, 0),
            w,
            h,
            camera,
          );

          if (dLeftPt.y > -20 && dLeftPt.y < h + 20) {
            const bannerH = SECTION_BANNER_HEIGHT;
            const bannerW = dRightPt.x - dLeftPt.x;

            ctx.fillStyle = SECTION_SELECTED_BG;
            ctx.fillRect(dLeftPt.x, dLeftPt.y - bannerH / 2, bannerW, bannerH);
            ctx.strokeStyle = SECTION_SELECTED_BORDER;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(dLeftPt.x, dLeftPt.y - bannerH / 2, bannerW, bannerH);
            ctx.strokeStyle = SECTION_LINE_COLOR;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(dLeftPt.x, dLeftPt.y);
            ctx.lineTo(dRightPt.x, dRightPt.y);
            ctx.stroke();
            ctx.fillStyle = SECTION_TEXT_COLOR;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(
              curDragSectionName,
              dLeftPt.x + 8,
              dLeftPt.y,
            );
          }
          } // close worldY bounds check
        }
      }

      // Draw confidence overlays and review indicators
      const curConfidence = confidenceRef.current;
      const curShowConfidence = showConfidenceRef.current;
      const curConfidenceThreshold = confidenceThresholdRef.current;
      const curReviewedNoteIds = reviewedNoteIdsRef.current;

      if (curShowConfidence && curConfidence && curConfidence.size > 0) {
        for (const note of notes) {
          const lane = typeToLane(note.type);
          const pos = localNoteToScreen(note.tick, lane);
          if (!pos || pos.y < -20 || pos.y > h + 20) continue;

          const id = noteId(note);
          const conf = curConfidence.get(id);

          if (conf !== undefined && conf < 0.9) {
            const bounds = laneScreenBounds(lane, pos.y);
            const noteRadius = bounds ? bounds.width / 3 : 12;

            if (conf < 0.5) {
              ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, noteRadius + 3, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
              ctx.font = 'bold 10px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('?', pos.x, pos.y);
            } else if (conf < curConfidenceThreshold) {
              ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, noteRadius + 2, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, noteRadius + 1, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }

      // Draw review indicators (small green check mark)
      if (curReviewedNoteIds && curReviewedNoteIds.size > 0) {
        for (const note of notes) {
          const id = noteId(note);
          if (!curReviewedNoteIds.has(id)) continue;
          const lane = typeToLane(note.type);
          const pos = localNoteToScreen(note.tick, lane);
          if (!pos || pos.y < -20 || pos.y > h + 20) continue;

          const bounds = laneScreenBounds(lane, pos.y);
          const offset = bounds ? bounds.width / 2 - 6 : 10;
          ctx.fillStyle = 'rgba(34, 197, 94, 0.7)';
          ctx.beginPath();
          ctx.arc(pos.x + offset, pos.y + 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw selection highlights
      if (st.selectedNoteIds.size > 0) {
        for (const note of notes) {
          if (!st.selectedNoteIds.has(noteId(note))) continue;
          const lane = typeToLane(note.type);
          const pos = localNoteToScreen(note.tick, lane);
          if (!pos || pos.y < -20 || pos.y > h + 20) continue;

          const bounds = laneScreenBounds(lane, pos.y);
          if (bounds) {
            ctx.fillStyle = SELECTION_COLOR;
            ctx.fillRect(bounds.left + 2, pos.y - 8, bounds.width - 4, 16);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(bounds.left + 2, pos.y - 8, bounds.width - 4, 16);
          }
        }
      }

      // Draw cursor line (when not playing)
      if (!st.isPlaying && handle) {
        const cursorTick = st.cursorTick;
        const cursorPos = localNoteToScreen(cursorTick, 0);
        if (cursorPos && cursorPos.y > 0 && cursorPos.y < h) {
          const camera = handle.getCamera();
          const highwaySpeed = handle.getHighwaySpeed();
          const currentMs = audioManager.currentTime * 1000;
          const delay = (audioManager.delay || 0) * 1000;
          const elapsedMs = currentMs - delay;

          // tick to ms for cursor
          let cTempoIdx = 0;
          for (let i = 1; i < tempos.length; i++) {
            if (tempos[i].tick <= cursorTick) cTempoIdx = i;
            else break;
          }
          const cTempo = tempos[cTempoIdx];
          const cursorMs =
            cTempo
              ? cTempo.msTime +
                ((cursorTick - cTempo.tick) * 60000) /
                  (cTempo.beatsPerMinute * res)
              : 0;
          const cursorWorldY =
            ((cursorMs - elapsedMs) / 1000) * highwaySpeed - 1;

          const leftPt = worldToScreen(
            new THREE.Vector3(-HIGHWAY_HALF_WIDTH, cursorWorldY, 0),
            w,
            h,
            camera,
          );
          const rightPt = worldToScreen(
            new THREE.Vector3(HIGHWAY_HALF_WIDTH, cursorWorldY, 0),
            w,
            h,
            camera,
          );

          // Draw cursor line
          ctx.strokeStyle = CURSOR_LINE_COLOR;
          ctx.lineWidth = CURSOR_LINE_WIDTH;
          ctx.beginPath();
          ctx.moveTo(leftPt.x, leftPt.y);
          ctx.lineTo(rightPt.x, rightPt.y);
          ctx.stroke();

          // Draw tick label next to cursor
          ctx.fillStyle = CURSOR_LINE_COLOR;
          ctx.font = '10px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`tick ${cursorTick}`, rightPt.x + 4, rightPt.y - 2);
        }
      }

      // Draw ghost note previews at cursor position (Place mode, all lanes)
      if (st.activeTool === 'place' && !st.isPlaying) {
        const cursorTick = st.cursorTick;
        for (let lane = 0; lane < NUM_LANES; lane++) {
          const pos = localNoteToScreen(cursorTick, lane);
          if (!pos || pos.y <= 0 || pos.y >= h) continue;
          const bounds = laneScreenBounds(lane, pos.y);
          const noteRadius = bounds ? bounds.width / 3 : 12;
          ctx.fillStyle = GHOST_LANE_COLORS[lane];
          ctx.beginPath();
          ctx.ellipse(pos.x, pos.y, noteRadius, 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw ghost note preview at mouse hover position (Place mode)
      if (
        st.activeTool === 'place' &&
        curHoverLane !== null &&
        curHoverTick !== null
      ) {
        const pos = localNoteToScreen(curHoverTick, curHoverLane);
        if (pos && pos.y > 0 && pos.y < h) {
          const bounds = laneScreenBounds(curHoverLane, pos.y);
          const noteRadius = bounds ? bounds.width / 3 : 12;
          ctx.fillStyle = LANE_COLORS[curHoverLane];
          ctx.beginPath();
          ctx.ellipse(pos.x, pos.y, noteRadius, 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw box selection rectangle (Cursor mode)
      if (
        st.activeTool === 'cursor' &&
        curDragStart &&
        curDragCurrent &&
        !curIsDragging
      ) {
        const x1 = Math.min(curDragStart.x, curDragCurrent.x);
        const y1 = Math.min(curDragStart.y, curDragCurrent.y);
        const bw = Math.abs(curDragCurrent.x - curDragStart.x);
        const bh = Math.abs(curDragCurrent.y - curDragStart.y);
        if (bw > 3 || bh > 3) {
          ctx.fillStyle = BOX_SELECT_COLOR;
          ctx.fillRect(x1, y1, bw, bh);
          ctx.strokeStyle = BOX_SELECT_BORDER;
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, y1, bw, bh);
        }
      }

      // Draw hover highlight for eraser
      if (st.activeTool === 'erase' && curHoverLane !== null && handle) {
        // Highlight the lane column using projected boundaries
        const bounds = laneScreenBounds(curHoverLane, h / 2);
        if (bounds) {
          // Draw a trapezoidal highlight that follows the perspective
          const camera = handle.getCamera();
          const laneX = LANE_X_POSITIONS[curHoverLane];
          const sortedLaneXs = LANE_X_POSITIONS.slice().sort(
            (a, b) => a - b,
          );
          const sortedIdx = sortedLaneXs.indexOf(laneX);
          let leftBoundX =
            sortedIdx === 0
              ? -HIGHWAY_HALF_WIDTH
              : (sortedLaneXs[sortedIdx - 1] + laneX) / 2;
          let rightBoundX =
            sortedIdx === sortedLaneXs.length - 1
              ? HIGHWAY_HALF_WIDTH
              : (laneX + sortedLaneXs[sortedIdx + 1]) / 2;

          const topLeft = worldToScreen(
            new THREE.Vector3(leftBoundX, 2, 0),
            w,
            h,
            camera,
          );
          const topRight = worldToScreen(
            new THREE.Vector3(rightBoundX, 2, 0),
            w,
            h,
            camera,
          );
          const botLeft = worldToScreen(
            new THREE.Vector3(leftBoundX, -1.5, 0),
            w,
            h,
            camera,
          );
          const botRight = worldToScreen(
            new THREE.Vector3(rightBoundX, -1.5, 0),
            w,
            h,
            camera,
          );

          ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
          ctx.beginPath();
          ctx.moveTo(topLeft.x, topLeft.y);
          ctx.lineTo(topRight.x, topRight.y);
          ctx.lineTo(botRight.x, botRight.y);
          ctx.lineTo(botLeft.x, botLeft.y);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Draw cursor crosshair for BPM/TimeSig/Section modes
      if (
        (st.activeTool === 'bpm' || st.activeTool === 'timesig' || st.activeTool === 'section') &&
        curHoverTick !== null &&
        handle
      ) {
        // Project the tick to screen Y at left and right highway edges
        const camera = handle.getCamera();
        const highwaySpeed = handle.getHighwaySpeed();
        const currentMs = audioManager.currentTime * 1000;
        const delay = (audioManager.delay || 0) * 1000;
        const elapsedMs = currentMs - delay;

        let tempoIdx = 0;
        for (let i = 1; i < tempos.length; i++) {
          if (tempos[i].tick <= curHoverTick) tempoIdx = i;
          else break;
        }
        const tempo = tempos[tempoIdx];
        const ms =
          tempo.msTime +
          ((curHoverTick - tempo.tick) * 60000) / (tempo.beatsPerMinute * res);
        const worldY = ((ms - elapsedMs) / 1000) * highwaySpeed - 1;

        const leftPt = worldToScreen(
          new THREE.Vector3(-HIGHWAY_HALF_WIDTH, worldY, 0),
          w,
          h,
          camera,
        );
        const rightPt = worldToScreen(
          new THREE.Vector3(HIGHWAY_HALF_WIDTH, worldY, 0),
          w,
          h,
          camera,
        );

        if (leftPt.y > 0 && leftPt.y < h) {
          ctx.strokeStyle =
            st.activeTool === 'bpm'
              ? 'rgba(255, 165, 0, 0.7)'
              : st.activeTool === 'timesig'
                ? 'rgba(147, 112, 219, 0.7)'
                : 'rgba(255, 200, 0, 0.7)';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(leftPt.x, leftPt.y);
          ctx.lineTo(rightPt.x, rightPt.y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = '11px monospace';
          ctx.fillText(
            st.activeTool === 'bpm'
              ? `BPM @ tick ${curHoverTick}`
              : st.activeTool === 'timesig'
                ? `TS @ tick ${curHoverTick}`
                : `Section @ tick ${curHoverTick}`,
            leftPt.x + 4,
            leftPt.y - 6,
          );
        }
      }

      // Draw loop region markers
      if (st.loopRegion && handle) {
        const startY = msToScreenY(st.loopRegion.startMs);
        const endY = msToScreenY(st.loopRegion.endMs);

        if (startY !== null && endY !== null) {
          // Loop region background tint
          if (endY < h && startY > 0) {
            ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
            ctx.fillRect(
              0,
              Math.max(0, endY),
              w,
              Math.min(h, startY) - Math.max(0, endY),
            );
          }

          // Loop start line
          if (startY > 0 && startY < h) {
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, startY);
            ctx.lineTo(w, startY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
            ctx.font = '10px sans-serif';
            ctx.fillText('A', 4, startY - 4);
          }

          // Loop end line
          if (endY > 0 && endY < h) {
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, endY);
            ctx.lineTo(w, endY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
            ctx.font = '10px sans-serif';
            ctx.fillText('B', 4, endY - 4);
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
    // This effect intentionally has a minimal dependency array.
    // All mutable values are read from refs inside the draw loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioManager]);

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
      case 'section':
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
        onRendererReady={handleRendererReady}
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
