/**
 * Type declarations for the WebCodecs ImageDecoder API.
 * This API is available in Chromium-based browsers (Chrome, Edge, Opera).
 * @see https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder
 */

interface ImageDecoderInit {
  data: ReadableStream | ArrayBuffer | ArrayBufferView;
  type: string;
  colorSpaceConversion?: 'default' | 'none';
  desiredHeight?: number;
  desiredWidth?: number;
  preferAnimation?: boolean;
}

interface ImageDecodeOptions {
  frameIndex?: number;
  completeFramesOnly?: boolean;
}

interface ImageDecodeResult {
  image: VideoFrame;
  complete: boolean;
}

interface ImageTrack {
  animated: boolean;
  frameCount: number;
  repetitionCount: number;
  selected: boolean;
}

interface ImageTrackList {
  readonly length: number;
  readonly ready: Promise<undefined>;
  readonly selectedIndex: number;
  readonly selectedTrack: ImageTrack | null;
  [index: number]: ImageTrack;
}

declare class ImageDecoder {
  constructor(init: ImageDecoderInit);

  readonly complete: boolean;
  readonly completed: Promise<undefined>;
  readonly tracks: ImageTrackList;
  readonly type: string;

  close(): void;
  decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult>;
  reset(): void;

  static isTypeSupported(type: string): Promise<boolean>;
}
