import * as THREE from 'three';
import {
  SCALE,
  NOTE_SPAN_WIDTH,
  calculateNoteXOffset,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGHWAY_HALF_WIDTH = 0.45;

/** Number of editor lanes (kick + 4 pad lanes). */
const NUM_LANES = 5;

/** 3D X positions for each editor lane (0=kick, 1-4=red/yellow/blue/green). */
const LANE_X_POSITIONS = [
  0, // kick -- centered
  ...Array.from({length: 4}, (_, i) => calculateNoteXOffset('drums', i)),
];

/** Lane colors for ghost notes (RGBA). */
const LANE_COLORS_HEX = [
  0xf8b272, // kick/orange
  0xdd2214, // red
  0xdeeb52, // yellow
  0x006caf, // blue
  0x01b11a, // green
];

// Section banner colors
const SECTION_BG_OPACITY = 0.15;
const SECTION_TEXT_COLOR_CSS = 'rgba(255, 200, 0, 0.9)';
const SECTION_SELECTED_BG_OPACITY = 0.35;
const SECTION_LINE_COLOR = 0xffc800;

// Cursor line color
const CURSOR_LINE_COLOR = 0x00ff80;

// ---------------------------------------------------------------------------
// Section banner texture cache
// ---------------------------------------------------------------------------

const sectionTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Create a text label texture for a section flag (Moonscraper-style).
 * White text on a semi-transparent green background, like Moonscraper's
 * section markers.
 */
function createSectionTexture(
  name: string,
  isSelected: boolean,
): THREE.CanvasTexture {
  const key = `${name}:${isSelected}`;
  const cached = sectionTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // Render at 2x resolution for crisp text on high-DPI / when scaled up
  const scale = 2;
  const fontSize = 24 * scale;
  const padding = 16 * scale;

  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(name);
  const textWidth = Math.ceil(metrics.width);
  canvas.width = textWidth + padding * 2;
  canvas.height = 36 * scale;

  // Background — green for sections (like Moonscraper)
  const bgAlpha = isSelected ? 0.6 : 0.35;
  ctx.fillStyle = `rgba(0, 200, 40, ${bgAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Selected border
  if (isSelected) {
    ctx.strokeStyle = 'rgba(100, 255, 100, 0.9)';
    ctx.lineWidth = 3 * scale;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  }

  // Text — white, crisp
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, padding, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  sectionTextureCache.set(key, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// Cursor tick label texture
// ---------------------------------------------------------------------------

function createTickLabelTexture(tick: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 24;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0, 255, 128, 0.8)';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`tick ${tick}`, 4, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// Crosshair label texture
// ---------------------------------------------------------------------------

function createCrosshairLabelTexture(
  toolMode: string,
  tick: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 24;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const label =
    toolMode === 'bpm'
      ? `BPM @ tick ${tick}`
      : toolMode === 'timesig'
        ? `TS @ tick ${tick}`
        : `Section @ tick ${tick}`;

  ctx.fillStyle =
    toolMode === 'bpm'
      ? 'rgba(255, 165, 0, 0.7)'
      : toolMode === 'timesig'
        ? 'rgba(147, 112, 219, 0.7)'
        : 'rgba(255, 200, 0, 0.7)';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 4, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// SceneOverlays
// ---------------------------------------------------------------------------

export interface SectionData {
  tick: number;
  name: string;
}

export interface OverlayState {
  /** Current cursor tick. -1 means hidden. */
  cursorTick: number;
  /** Whether playback is active (hides cursor line). */
  isPlaying: boolean;
  /** Active tool mode. */
  activeTool: string;
  /** Hover lane (null = not hovering). */
  hoverLane: number | null;
  /** Hover tick (null = not hovering). */
  hoverTick: number | null;
  /** Sections from chart doc. */
  sections: SectionData[];
  /** Currently selected section tick (null = none). */
  selectedSectionTick: number | null;
  /** Section currently being dragged (null = not dragging). */
  sectionDrag: {
    originalTick: number;
    currentTick: number;
    name: string;
  } | null;
  /** Loop region (null = no loop). */
  loopRegion: {startMs: number; endMs: number} | null;
}

/**
 * Manages 3D overlays in the highway scene: cursor line, section banners,
 * ghost notes, lane dividers, eraser highlight, tool crosshairs, and loop markers.
 *
 * All overlays live in the Three.js scene and are positioned in world space,
 * so they match the 3D perspective exactly.
 */
export class SceneOverlays {
  private scene: THREE.Scene;
  private highwaySpeed: number;
  private clippingPlanes: THREE.Plane[];

  // Cursor line
  private cursorLine: THREE.Line | null = null;
  private cursorLineMaterial: THREE.LineBasicMaterial | null = null;
  private cursorTickLabel: THREE.Sprite | null = null;
  private cursorTickLabelTexture: THREE.CanvasTexture | null = null;
  private lastCursorTick = -1;

  // Lane dividers
  private laneDividers: THREE.Line[] = [];

  // Section banners
  private sectionBannerGroup = new THREE.Group();
  /** Pool of section banner meshes to reuse. */
  private sectionBannerPool: THREE.Mesh[] = [];
  private sectionLinePool: THREE.Line[] = [];
  /** Currently active section meshes (tick -> mesh). */
  private activeSectionMeshes: {mesh: THREE.Mesh; line: THREE.Line}[] = [];

  // Ghost notes (Place mode)
  private ghostNoteGroup = new THREE.Group();
  private ghostNoteMeshes: THREE.Mesh[] = [];

  // Hover ghost (single, brighter)
  private hoverGhostMesh: THREE.Mesh | null = null;

  // Eraser highlight
  private eraserHighlight: THREE.Mesh | null = null;

  // Tool crosshair (BPM/TS/Section)
  private crosshairLine: THREE.Line | null = null;
  private crosshairLineMaterial: THREE.LineBasicMaterial | null = null;
  private crosshairLabel: THREE.Sprite | null = null;
  private crosshairLabelTexture: THREE.CanvasTexture | null = null;
  private lastCrosshairTick = -1;
  private lastCrosshairTool = '';

  // Loop region
  private loopGroup = new THREE.Group();
  private loopStartLine: THREE.Line | null = null;
  private loopEndLine: THREE.Line | null = null;
  private loopTint: THREE.Mesh | null = null;
  private loopStartLabel: THREE.Sprite | null = null;
  private loopEndLabel: THREE.Sprite | null = null;

  // Tempo data for tick->ms conversion
  private timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[] = [];
  private resolution = 480;

  constructor(
    scene: THREE.Scene,
    highwaySpeed: number,
    clippingPlanes: THREE.Plane[],
  ) {
    this.scene = scene;
    this.highwaySpeed = highwaySpeed;
    this.clippingPlanes = clippingPlanes;

    // Add container groups to scene
    this.scene.add(this.sectionBannerGroup);
    this.scene.add(this.ghostNoteGroup);
    this.scene.add(this.loopGroup);

    // Create lane dividers
    this.createLaneDividers();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Update tempo data for tick-to-ms conversion. */
  setTimingData(
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): void {
    this.timedTempos = timedTempos;
    this.resolution = resolution;
  }

  /**
   * Called every frame. Repositions all overlay elements based on current time.
   */
  update(currentTimeMs: number, state: OverlayState): void {
    const elapsedMs = currentTimeMs;

    // Update cursor line
    this.updateCursorLine(elapsedMs, state);

    // Update section banners
    this.updateSectionBanners(elapsedMs, state);

    // Update ghost notes
    this.updateGhostNotes(elapsedMs, state);

    // Update eraser highlight
    this.updateEraserHighlight(state);

    // Update tool crosshair
    this.updateCrosshair(elapsedMs, state);

    // Update loop region
    this.updateLoopRegion(elapsedMs, state);
  }

  /** Clean up all Three.js resources. */
  dispose(): void {
    // Cursor
    this.cursorLine?.geometry.dispose();
    this.cursorLineMaterial?.dispose();
    if (this.cursorLine) this.scene.remove(this.cursorLine);
    this.cursorTickLabel?.material instanceof THREE.SpriteMaterial &&
      this.cursorTickLabel.material.dispose();
    this.cursorTickLabelTexture?.dispose();
    if (this.cursorTickLabel) this.scene.remove(this.cursorTickLabel);

    // Lane dividers
    for (const line of this.laneDividers) {
      line.geometry.dispose();
      (line.material as THREE.LineBasicMaterial).dispose();
      this.scene.remove(line);
    }

    // Section banners
    this.scene.remove(this.sectionBannerGroup);
    for (const item of this.activeSectionMeshes) {
      item.mesh.geometry.dispose();
      (item.mesh.material as THREE.MeshBasicMaterial).dispose();
      item.line.geometry.dispose();
      (item.line.material as THREE.LineBasicMaterial).dispose();
    }
    for (const mesh of this.sectionBannerPool) {
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    for (const line of this.sectionLinePool) {
      line.geometry.dispose();
      (line.material as THREE.LineBasicMaterial).dispose();
    }

    // Ghost notes
    this.scene.remove(this.ghostNoteGroup);
    for (const mesh of this.ghostNoteMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    if (this.hoverGhostMesh) {
      this.hoverGhostMesh.geometry.dispose();
      (this.hoverGhostMesh.material as THREE.MeshBasicMaterial).dispose();
    }

    // Eraser highlight
    if (this.eraserHighlight) {
      this.eraserHighlight.geometry.dispose();
      (this.eraserHighlight.material as THREE.MeshBasicMaterial).dispose();
      this.scene.remove(this.eraserHighlight);
    }

    // Crosshair
    this.crosshairLine?.geometry.dispose();
    this.crosshairLineMaterial?.dispose();
    if (this.crosshairLine) this.scene.remove(this.crosshairLine);
    this.crosshairLabel?.material instanceof THREE.SpriteMaterial &&
      this.crosshairLabel.material.dispose();
    this.crosshairLabelTexture?.dispose();
    if (this.crosshairLabel) this.scene.remove(this.crosshairLabel);

    // Loop region
    this.scene.remove(this.loopGroup);

    // Clear section texture cache
    for (const texture of sectionTextureCache.values()) {
      texture.dispose();
    }
    sectionTextureCache.clear();
  }

  // -----------------------------------------------------------------------
  // Lane dividers
  // -----------------------------------------------------------------------

  private createLaneDividers(): void {
    // Only draw dividers between the 4 pad lanes (red, yellow, blue, green).
    // Kick (lane 0, x=0) spans the full highway width and should not have dividers.
    const padLaneXs = LANE_X_POSITIONS.slice(1).sort((a, b) => a - b);
    for (let i = 0; i < padLaneXs.length - 1; i++) {
      const boundaryX = (padLaneXs[i] + padLaneXs[i + 1]) / 2;

      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(boundaryX, -1.5, 0),
        new THREE.Vector3(boundaryX, 2, 0),
      ]);
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        depthTest: false,
      });
      material.clippingPlanes = this.clippingPlanes;
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 2;
      this.scene.add(line);
      this.laneDividers.push(line);
    }
  }

  // -----------------------------------------------------------------------
  // Cursor line
  // -----------------------------------------------------------------------

  private updateCursorLine(
    elapsedMs: number,
    state: OverlayState,
  ): void {
    if (state.isPlaying || state.cursorTick < 0 || this.timedTempos.length === 0) {
      // Hide cursor line during playback or when no cursor
      if (this.cursorLine) this.cursorLine.visible = false;
      if (this.cursorTickLabel) this.cursorTickLabel.visible = false;
      return;
    }

    const cursorMs = this.tickToMs(state.cursorTick);
    const worldY = this.msToWorldY(cursorMs, elapsedMs);

    // Only show if on-screen
    if (worldY < -1.2 || worldY > 1.1) {
      if (this.cursorLine) this.cursorLine.visible = false;
      if (this.cursorTickLabel) this.cursorTickLabel.visible = false;
      return;
    }

    // Create cursor line if needed
    if (!this.cursorLine) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-HIGHWAY_HALF_WIDTH, 0, 0),
        new THREE.Vector3(HIGHWAY_HALF_WIDTH, 0, 0),
      ]);
      this.cursorLineMaterial = new THREE.LineBasicMaterial({
        color: CURSOR_LINE_COLOR,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        linewidth: 2,
      });
      this.cursorLineMaterial.clippingPlanes = this.clippingPlanes;
      this.cursorLine = new THREE.Line(geometry, this.cursorLineMaterial);
      this.cursorLine.renderOrder = 10;
      this.scene.add(this.cursorLine);
    }

    this.cursorLine.position.y = worldY;
    this.cursorLine.visible = true;

    // Update tick label
    if (state.cursorTick !== this.lastCursorTick) {
      this.lastCursorTick = state.cursorTick;
      this.cursorTickLabelTexture?.dispose();
      this.cursorTickLabelTexture = createTickLabelTexture(state.cursorTick);

      if (!this.cursorTickLabel) {
        const labelMat = new THREE.SpriteMaterial({
          map: this.cursorTickLabelTexture,
          transparent: true,
          depthTest: false,
        });
        this.cursorTickLabel = new THREE.Sprite(labelMat);
        this.cursorTickLabel.scale.set(0.15, 0.03, 1);
        this.cursorTickLabel.renderOrder = 11;
        this.scene.add(this.cursorTickLabel);
      } else {
        (this.cursorTickLabel.material as THREE.SpriteMaterial).map =
          this.cursorTickLabelTexture;
        (this.cursorTickLabel.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }

    if (this.cursorTickLabel) {
      this.cursorTickLabel.position.set(
        HIGHWAY_HALF_WIDTH + 0.1,
        worldY,
        0,
      );
      this.cursorTickLabel.visible = true;
    }
  }

  // -----------------------------------------------------------------------
  // Section banners
  // -----------------------------------------------------------------------

  private updateSectionBanners(
    elapsedMs: number,
    state: OverlayState,
  ): void {
    // Return all active banners to pool
    for (const item of this.activeSectionMeshes) {
      item.mesh.visible = false;
      item.line.visible = false;
      this.sectionBannerGroup.remove(item.mesh);
      this.sectionBannerGroup.remove(item.line);
      this.sectionBannerPool.push(item.mesh);
      this.sectionLinePool.push(item.line);
    }
    this.activeSectionMeshes = [];

    if (this.timedTempos.length === 0) return;

    const sections = state.sections;
    const dragOriginalTick = state.sectionDrag?.originalTick ?? -1;

    for (const section of sections) {
      // Skip section being dragged at its original position
      if (section.tick === dragOriginalTick) continue;

      const sMs = this.tickToMs(section.tick);
      const worldY = this.msToWorldY(sMs, elapsedMs);

      if (worldY < -1.2 || worldY > 1.1) continue;

      const isSelected = state.selectedSectionTick === section.tick;
      this.addSectionBanner(section.name, worldY, isSelected);
    }

    // Draw section being dragged at its drag position
    if (state.sectionDrag) {
      const dragMs = this.tickToMs(state.sectionDrag.currentTick);
      const dragWorldY = this.msToWorldY(dragMs, elapsedMs);
      if (dragWorldY >= -1.2 && dragWorldY <= 1.1) {
        this.addSectionBanner(state.sectionDrag.name, dragWorldY, true);
      }
    }
  }

  private addSectionBanner(
    name: string,
    worldY: number,
    isSelected: boolean,
  ): void {
    // --- Text flag sprite (faces camera, right side of highway) ---
    let mesh: THREE.Sprite;
    if (this.sectionBannerPool.length > 0) {
      mesh = this.sectionBannerPool.pop()! as unknown as THREE.Sprite;
    } else {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        depthTest: false,
      });
      mesh = new THREE.Sprite(material);
      mesh.renderOrder = 8;
      // Anchor at left edge so it extends rightward from the highway
      mesh.center.set(0.0, 0.5);
    }

    const texture = createSectionTexture(name, isSelected);
    (mesh.material as THREE.SpriteMaterial).map = texture;
    (mesh.material as THREE.SpriteMaterial).needsUpdate = true;

    // Scale proportional to texture aspect ratio
    const texCanvas = texture.image as HTMLCanvasElement;
    const aspect = texCanvas.width / texCanvas.height;
    const flagHeight = 0.055;
    mesh.scale.set(flagHeight * aspect, flagHeight, 1);

    // Position to the right of the highway edge
    mesh.position.set(HIGHWAY_HALF_WIDTH + 0.02, worldY, 0.001);
    mesh.visible = true;
    this.sectionBannerGroup.add(mesh);

    // --- Thin green marker line across the highway ---
    let line: THREE.Mesh;
    if (this.sectionLinePool.length > 0) {
      line = this.sectionLinePool.pop()! as unknown as THREE.Mesh;
    } else {
      const lineGeom = new THREE.PlaneGeometry(HIGHWAY_HALF_WIDTH * 2, 0.003);
      const lineMat = new THREE.MeshBasicMaterial({
        color: 0x00cc28, // green, like Moonscraper sections
        transparent: true,
        opacity: 0.4,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      lineMat.clippingPlanes = this.clippingPlanes;
      line = new THREE.Mesh(lineGeom, lineMat);
      line.renderOrder = 2;
    }

    (line.material as THREE.MeshBasicMaterial).opacity = isSelected ? 0.7 : 0.4;
    line.position.set(0, worldY, 0.001);
    line.visible = true;
    this.sectionBannerGroup.add(line);

    this.activeSectionMeshes.push({mesh: mesh as unknown as THREE.Mesh, line: line as unknown as THREE.Line});
  }

  // -----------------------------------------------------------------------
  // Ghost notes (Place mode)
  // -----------------------------------------------------------------------

  private updateGhostNotes(
    elapsedMs: number,
    state: OverlayState,
  ): void {
    // Hide all ghost notes first
    for (const mesh of this.ghostNoteMeshes) {
      mesh.visible = false;
    }
    if (this.hoverGhostMesh) {
      this.hoverGhostMesh.visible = false;
    }

    if (state.activeTool !== 'place' || state.isPlaying) return;
    if (this.timedTempos.length === 0) return;

    // Ghost notes follow the hover position (where the user would click)
    // rather than the cursor position (which may be elsewhere).
    if (state.hoverTick === null) return;

    const ghostTick = state.hoverTick;
    const ghostMs = this.tickToMs(ghostTick);
    const ghostWorldY = this.msToWorldY(ghostMs, elapsedMs);

    if (ghostWorldY < -1.2 || ghostWorldY > 1.1) return;

    // Show ghost note outlines at the hover tick for all lanes
    for (let lane = 0; lane < NUM_LANES; lane++) {
      // Ensure we have enough ghost note meshes
      while (this.ghostNoteMeshes.length <= lane) {
        const geometry = new THREE.PlaneGeometry(SCALE * 1.2, SCALE * 0.5);
        const material = new THREE.MeshBasicMaterial({
          color: LANE_COLORS_HEX[this.ghostNoteMeshes.length],
          transparent: true,
          opacity: 0.25,
          depthTest: false,
          side: THREE.DoubleSide,
        });
        material.clippingPlanes = this.clippingPlanes;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 6;
        this.ghostNoteGroup.add(mesh);
        this.ghostNoteMeshes.push(mesh);
      }

      const mesh = this.ghostNoteMeshes[lane];
      mesh.position.set(LANE_X_POSITIONS[lane], ghostWorldY, 0.001);
      mesh.visible = true;
    }

    // Hover ghost: brighter highlight at the specific hovered lane
    if (state.hoverLane !== null) {
      if (!this.hoverGhostMesh) {
        const geometry = new THREE.PlaneGeometry(SCALE * 1.2, SCALE * 0.5);
        const material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.5,
          depthTest: false,
          side: THREE.DoubleSide,
        });
        material.clippingPlanes = this.clippingPlanes;
        this.hoverGhostMesh = new THREE.Mesh(geometry, material);
        this.hoverGhostMesh.renderOrder = 7;
        this.ghostNoteGroup.add(this.hoverGhostMesh);
      }

      (this.hoverGhostMesh.material as THREE.MeshBasicMaterial).color.set(
        LANE_COLORS_HEX[state.hoverLane],
      );
      (this.hoverGhostMesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
      this.hoverGhostMesh.position.set(
        LANE_X_POSITIONS[state.hoverLane],
        ghostWorldY,
        0.001,
      );
      this.hoverGhostMesh.visible = true;
    }
  }

  // -----------------------------------------------------------------------
  // Eraser highlight
  // -----------------------------------------------------------------------

  private updateEraserHighlight(state: OverlayState): void {
    if (state.activeTool !== 'erase' || state.hoverLane === null) {
      if (this.eraserHighlight) this.eraserHighlight.visible = false;
      return;
    }

    const laneX = LANE_X_POSITIONS[state.hoverLane];
    const sortedLaneXs = LANE_X_POSITIONS.slice().sort((a, b) => a - b);
    const sortedIdx = sortedLaneXs.indexOf(laneX);

    const leftBoundX =
      sortedIdx === 0
        ? -HIGHWAY_HALF_WIDTH
        : (sortedLaneXs[sortedIdx - 1] + laneX) / 2;
    const rightBoundX =
      sortedIdx === sortedLaneXs.length - 1
        ? HIGHWAY_HALF_WIDTH
        : (laneX + sortedLaneXs[sortedIdx + 1]) / 2;

    const width = rightBoundX - leftBoundX;
    const centerX = (leftBoundX + rightBoundX) / 2;

    if (!this.eraserHighlight) {
      const geometry = new THREE.PlaneGeometry(1, 3.5);
      const material = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.15,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      this.eraserHighlight = new THREE.Mesh(geometry, material);
      this.eraserHighlight.renderOrder = 5;
      this.scene.add(this.eraserHighlight);
    }

    // Update geometry to match lane width
    this.eraserHighlight.geometry.dispose();
    this.eraserHighlight.geometry = new THREE.PlaneGeometry(width, 3.5);
    this.eraserHighlight.position.set(centerX, 0.25, 0);
    this.eraserHighlight.visible = true;
  }

  // -----------------------------------------------------------------------
  // Tool crosshair (BPM / TimeSig / Section)
  // -----------------------------------------------------------------------

  private updateCrosshair(
    elapsedMs: number,
    state: OverlayState,
  ): void {
    const isToolMode =
      state.activeTool === 'bpm' ||
      state.activeTool === 'timesig' ||
      state.activeTool === 'section';

    if (!isToolMode || state.hoverTick === null || this.timedTempos.length === 0) {
      if (this.crosshairLine) this.crosshairLine.visible = false;
      if (this.crosshairLabel) this.crosshairLabel.visible = false;
      return;
    }

    const hoverMs = this.tickToMs(state.hoverTick);
    const worldY = this.msToWorldY(hoverMs, elapsedMs);

    if (worldY < -1.2 || worldY > 1.1) {
      if (this.crosshairLine) this.crosshairLine.visible = false;
      if (this.crosshairLabel) this.crosshairLabel.visible = false;
      return;
    }

    // Line color per tool
    const lineColor =
      state.activeTool === 'bpm'
        ? 0xffa500
        : state.activeTool === 'timesig'
          ? 0x9370db
          : 0xffc800;

    // Create or update line
    if (!this.crosshairLine) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-HIGHWAY_HALF_WIDTH, 0, 0),
        new THREE.Vector3(HIGHWAY_HALF_WIDTH, 0, 0),
      ]);
      this.crosshairLineMaterial = new THREE.LineBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      });
      this.crosshairLineMaterial.clippingPlanes = this.clippingPlanes;
      this.crosshairLine = new THREE.Line(geometry, this.crosshairLineMaterial);
      this.crosshairLine.renderOrder = 10;
      this.scene.add(this.crosshairLine);
    }

    this.crosshairLineMaterial!.color.set(lineColor);
    this.crosshairLine.position.y = worldY;
    this.crosshairLine.visible = true;

    // Update label
    if (
      state.hoverTick !== this.lastCrosshairTick ||
      state.activeTool !== this.lastCrosshairTool
    ) {
      this.lastCrosshairTick = state.hoverTick;
      this.lastCrosshairTool = state.activeTool;
      this.crosshairLabelTexture?.dispose();
      this.crosshairLabelTexture = createCrosshairLabelTexture(
        state.activeTool,
        state.hoverTick,
      );

      if (!this.crosshairLabel) {
        const labelMat = new THREE.SpriteMaterial({
          map: this.crosshairLabelTexture,
          transparent: true,
          depthTest: false,
        });
        this.crosshairLabel = new THREE.Sprite(labelMat);
        this.crosshairLabel.scale.set(0.25, 0.025, 1);
        this.crosshairLabel.renderOrder = 11;
        this.scene.add(this.crosshairLabel);
      } else {
        (this.crosshairLabel.material as THREE.SpriteMaterial).map =
          this.crosshairLabelTexture;
        (this.crosshairLabel.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }

    if (this.crosshairLabel) {
      this.crosshairLabel.position.set(
        -HIGHWAY_HALF_WIDTH + 0.12,
        worldY + 0.015,
        0,
      );
      this.crosshairLabel.visible = true;
    }
  }

  // -----------------------------------------------------------------------
  // Loop region
  // -----------------------------------------------------------------------

  private updateLoopRegion(
    elapsedMs: number,
    state: OverlayState,
  ): void {
    if (!state.loopRegion) {
      // Hide all loop elements
      if (this.loopStartLine) this.loopStartLine.visible = false;
      if (this.loopEndLine) this.loopEndLine.visible = false;
      if (this.loopTint) this.loopTint.visible = false;
      if (this.loopStartLabel) this.loopStartLabel.visible = false;
      if (this.loopEndLabel) this.loopEndLabel.visible = false;
      return;
    }

    const startWorldY = this.msToWorldY(state.loopRegion.startMs, elapsedMs);
    const endWorldY = this.msToWorldY(state.loopRegion.endMs, elapsedMs);

    // Create loop elements if needed
    if (!this.loopStartLine) {
      this.createLoopElements();
    }

    // Update positions
    const loopColor = 0x3b82f6;
    const width = HIGHWAY_HALF_WIDTH * 2;

    // Start line
    this.loopStartLine!.position.y = startWorldY;
    this.loopStartLine!.visible =
      startWorldY >= -1.2 && startWorldY <= 1.1;

    // End line
    this.loopEndLine!.position.y = endWorldY;
    this.loopEndLine!.visible =
      endWorldY >= -1.2 && endWorldY <= 1.1;

    // Tint region
    const regionHeight = endWorldY - startWorldY;
    if (regionHeight > 0) {
      this.loopTint!.geometry.dispose();
      this.loopTint!.geometry = new THREE.PlaneGeometry(width, regionHeight);
      this.loopTint!.position.set(
        0,
        startWorldY + regionHeight / 2,
        -0.001,
      );
      this.loopTint!.visible = true;
    } else {
      this.loopTint!.visible = false;
    }

    // Labels
    if (this.loopStartLabel) {
      this.loopStartLabel.position.set(
        -HIGHWAY_HALF_WIDTH - 0.03,
        startWorldY,
        0,
      );
      this.loopStartLabel.visible =
        startWorldY >= -1.2 && startWorldY <= 1.1;
    }
    if (this.loopEndLabel) {
      this.loopEndLabel.position.set(
        -HIGHWAY_HALF_WIDTH - 0.03,
        endWorldY,
        0,
      );
      this.loopEndLabel.visible =
        endWorldY >= -1.2 && endWorldY <= 1.1;
    }
  }

  private createLoopElements(): void {
    const loopColor = 0x3b82f6;

    // Start line
    const startGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-HIGHWAY_HALF_WIDTH, 0, 0),
      new THREE.Vector3(HIGHWAY_HALF_WIDTH, 0, 0),
    ]);
    const startMat = new THREE.LineBasicMaterial({
      color: loopColor,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    startMat.clippingPlanes = this.clippingPlanes;
    this.loopStartLine = new THREE.Line(startGeom, startMat);
    this.loopStartLine.renderOrder = 9;
    this.loopGroup.add(this.loopStartLine);

    // End line
    const endGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-HIGHWAY_HALF_WIDTH, 0, 0),
      new THREE.Vector3(HIGHWAY_HALF_WIDTH, 0, 0),
    ]);
    const endMat = new THREE.LineBasicMaterial({
      color: loopColor,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    endMat.clippingPlanes = this.clippingPlanes;
    this.loopEndLine = new THREE.Line(endGeom, endMat);
    this.loopEndLine.renderOrder = 9;
    this.loopGroup.add(this.loopEndLine);

    // Tint
    const tintGeom = new THREE.PlaneGeometry(HIGHWAY_HALF_WIDTH * 2, 1);
    const tintMat = new THREE.MeshBasicMaterial({
      color: loopColor,
      transparent: true,
      opacity: 0.08,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    tintMat.clippingPlanes = this.clippingPlanes;
    this.loopTint = new THREE.Mesh(tintGeom, tintMat);
    this.loopTint.renderOrder = 1;
    this.loopGroup.add(this.loopTint);

    // Label A
    this.loopStartLabel = this.createLoopLabel('A');
    this.loopGroup.add(this.loopStartLabel);

    // Label B
    this.loopEndLabel = this.createLoopLabel('B');
    this.loopGroup.add(this.loopEndLabel);
  }

  private createLoopLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, 12);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.03, 0.03, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  // -----------------------------------------------------------------------
  // Timing helpers
  // -----------------------------------------------------------------------

  private tickToMs(tick: number): number {
    if (this.timedTempos.length === 0) return 0;
    let idx = 0;
    for (let i = 1; i < this.timedTempos.length; i++) {
      if (this.timedTempos[i].tick <= tick) idx = i;
      else break;
    }
    const tempo = this.timedTempos[idx];
    return (
      tempo.msTime +
      ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * this.resolution)
    );
  }

  private msToWorldY(ms: number, elapsedMs: number): number {
    return ((ms - elapsedMs) / 1000) * this.highwaySpeed - 1;
  }
}
