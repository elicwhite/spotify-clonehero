/**
 * The visual areas' blocks (text, fx, ui, brand, camera): one composition
 * per block, grouped by area. Every block cues in seconds, so a variant at
 * another frame rate plays at the same speed. `stillsSec` are the moments
 * worth looking at; the first is the composition's `hero` frame, which the
 * kit's `stills.ts --heroes` renders.
 */
import {Composition, Folder} from 'remotion';
import {
  BrandMarkBlock,
  BrandStageBlock,
  EndCardBlock,
  LogoStingBlock,
  ServiceMarksBlock,
  WordmarkBlock,
} from './brand/BrandBlocks';
import {PlacedPiecesBlock, PlaneCameraBlock} from './camera/CameraBlocks';
import {
  CameraShakeBlock,
  ChromaSplitBlock,
  DepthOfFieldBlock,
  GlassPlaneBlock,
  MotionBlurBlock,
  PopBlock,
  WhipFilterBlock,
} from './fx/LensBlocks';
import {
  BokehBlock,
  FlashBlock,
  GlowBlock,
  GrainBlock,
  LightSweepBlock,
  ShockwaveBlock,
  SideShadeBlock,
  SparkBurstBlock,
  VignetteBlock,
} from './fx/LightBlocks';
import {KineticPresetsBlock, KineticTextBlock} from './text/TextBlocks';
import {
  BeatMarkerBlock,
  CalloutBlock,
  ChapterSlateBlock,
  ChipBlock,
  ClickRingBlock,
  CursorBlock,
  EyebrowBlock,
  PlaneMarksBlock,
  WaveformBlock,
} from './ui/UiBlocks';
import type {VisualBlockProps} from './visualShared';

export interface VisualBlock {
  id: string;
  component: React.FC<VisualBlockProps>;
  durationSec: number;
  /** Seconds worth a still (past the end means the last frame). */
  stillsSec: readonly number[];
  fps?: number;
  width?: number;
  height?: number;
}

const DEFAULT_FPS = 60;

const fpsOf = (b: VisualBlock): number => b.fps ?? DEFAULT_FPS;

/** A block's length in frames at its own rate. */
export const blockFrames = (b: VisualBlock): number =>
  Math.round(b.durationSec * fpsOf(b));

/** A block's still frames at its own rate. */
export const stillFrames = (b: VisualBlock): number[] =>
  b.stillsSec.map(sec =>
    Math.min(blockFrames(b) - 1, Math.round(sec * fpsOf(b))),
  );

/** The 30 fps portrait variant of a block. */
const vertical30 = (b: VisualBlock, stillsSec = b.stillsSec): VisualBlock => ({
  ...b,
  id: `${b.id}-Vertical30`,
  stillsSec,
  fps: 30,
  width: 1080,
  height: 1920,
});

const CHAPTER_SLATE: VisualBlock = {
  id: 'Ui-ChapterSlate',
  component: ChapterSlateBlock,
  durationSec: 4.5,
  stillsSec: [2.5, 3.53],
};

const END_CARD: VisualBlock = {
  id: 'Brand-EndCard',
  component: EndCardBlock,
  durationSec: 6,
  stillsSec: [0.83, 6],
};

const PLANE_CAMERA: VisualBlock = {
  id: 'Camera-PlaneCamera',
  component: PlaneCameraBlock,
  durationSec: 3.33,
  stillsSec: [0.33, 1.07, 2.33],
};

/** Every visual block, by area. The default format is 1920 x 1080 at 60 fps. */
export const VISUAL_BLOCKS: Record<string, readonly VisualBlock[]> = {
  Text: [
    {
      id: 'Text-KineticText',
      component: KineticTextBlock,
      durationSec: 4,
      stillsSec: [1.17, 2.5],
    },
    {
      id: 'Text-Presets',
      component: KineticPresetsBlock,
      durationSec: 2,
      stillsSec: [1],
    },
  ],
  Fx: [
    {id: 'Fx-Grain', component: GrainBlock, durationSec: 1, stillsSec: [0.17]},
    {
      id: 'Fx-Vignette',
      component: VignetteBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {id: 'Fx-Glow', component: GlowBlock, durationSec: 0.5, stillsSec: [0]},
    {id: 'Fx-Flash', component: FlashBlock, durationSec: 1, stillsSec: [0.52]},
    {
      id: 'Fx-Shockwave',
      component: ShockwaveBlock,
      durationSec: 1.5,
      stillsSec: [0.7],
    },
    {
      id: 'Fx-SparkBurst',
      component: SparkBurstBlock,
      durationSec: 1.5,
      stillsSec: [0.67],
    },
    {
      id: 'Fx-LightSweep',
      component: LightSweepBlock,
      durationSec: 1.5,
      stillsSec: [0.52],
    },
    {
      id: 'Fx-Bokeh',
      component: BokehBlock,
      durationSec: 120,
      stillsSec: [0.5, 90],
    },
    {
      id: 'Fx-SideShade',
      component: SideShadeBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {
      id: 'Fx-ChromaSplit',
      component: ChromaSplitBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {
      id: 'Fx-CameraShake',
      component: CameraShakeBlock,
      durationSec: 1,
      stillsSec: [0.53],
    },
    {
      id: 'Fx-MotionBlur',
      component: MotionBlurBlock,
      durationSec: 1.5,
      stillsSec: [0.33],
    },
    {
      id: 'Fx-WhipFilter',
      component: WhipFilterBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {
      id: 'Fx-Pop',
      component: PopBlock,
      durationSec: 2,
      stillsSec: [0.45, 1.5],
    },
    {
      id: 'Fx-GlassPlane',
      component: GlassPlaneBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {
      id: 'Fx-DepthOfField',
      component: DepthOfFieldBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
  ],
  Ui: [
    {
      id: 'Ui-Cursor',
      component: CursorBlock,
      durationSec: 2,
      stillsSec: [0.57, 0.73],
    },
    {
      id: 'Ui-ClickRing',
      component: ClickRingBlock,
      durationSec: 1.5,
      stillsSec: [0.6],
    },
    {id: 'Ui-Callout', component: CalloutBlock, durationSec: 2, stillsSec: [1]},
    {
      id: 'Ui-PlaneMarks',
      component: PlaneMarksBlock,
      durationSec: 1.5,
      stillsSec: [0.57],
    },
    {id: 'Ui-Chip', component: ChipBlock, durationSec: 0.5, stillsSec: [0]},
    {
      id: 'Ui-Eyebrow',
      component: EyebrowBlock,
      durationSec: 2.5,
      stillsSec: [0.67, 2],
    },
    CHAPTER_SLATE,
    {
      ...CHAPTER_SLATE,
      id: 'Ui-ChapterSlate-720p30',
      stillsSec: [2.5],
      fps: 30,
      width: 1280,
      height: 720,
    },
    vertical30(CHAPTER_SLATE, [2.5]),
    {
      id: 'Ui-Waveform',
      component: WaveformBlock,
      durationSec: 2,
      stillsSec: [1],
    },
    {
      id: 'Ui-BeatMarker',
      component: BeatMarkerBlock,
      durationSec: 1.5,
      stillsSec: [0.67],
    },
  ],
  Brand: [
    {
      id: 'Brand-BrandMark',
      component: BrandMarkBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {
      id: 'Brand-Wordmark',
      component: WordmarkBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {
      id: 'Brand-ServiceMarks',
      component: ServiceMarksBlock,
      durationSec: 0.5,
      stillsSec: [0],
    },
    {
      id: 'Brand-BrandStage',
      component: BrandStageBlock,
      durationSec: 3,
      stillsSec: [0.23, 1.5, 2.77],
    },
    END_CARD,
    vertical30(END_CARD, [6]),
    {
      // The sting is rendered at 60 fps, so the block has no 30 fps variant.
      id: 'Brand-LogoSting',
      component: LogoStingBlock,
      durationSec: 3,
      stillsSec: [0.75, 1.05, 1.45, 2, 2.83],
    },
  ],
  Camera: [
    PLANE_CAMERA,
    vertical30(PLANE_CAMERA, [2.33]),
    {
      id: 'Camera-PlacedPieces',
      component: PlacedPiecesBlock,
      durationSec: 3,
      stillsSec: [0.17, 1.67, 2.5],
    },
  ],
};

/** The visual blocks as Studio folders. */
export const VisualBlocks: React.FC = () => (
  <>
    {Object.entries(VISUAL_BLOCKS).map(([area, blocks]) => (
      <Folder key={area} name={area}>
        {blocks.map(b => (
          <Composition
            key={b.id}
            id={b.id}
            component={b.component}
            durationInFrames={blockFrames(b)}
            fps={fpsOf(b)}
            width={b.width ?? 1920}
            height={b.height ?? 1080}
            defaultProps={{hero: stillFrames(b)[0] ?? 0}}
          />
        ))}
      </Folder>
    ))}
  </>
);
