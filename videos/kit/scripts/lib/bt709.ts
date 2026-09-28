/**
 * BT.709 limited range for H.264 made with ffmpeg: the colour tags, the
 * bitstream filter that retags a stream in place, and the filter chain that
 * converts (and optionally scales) frames into it.
 *
 * ffmpeg (8, and 7.1, which Remotion bundles) takes a frame's own colour
 * properties over the -color_* output options, and frames converted from
 * RGB (a PNG pipe, a Remotion render) carry the matrix and range but no
 * primaries or transfer, so the file is written with those two unset
 * whatever the options ask. The chain therefore ends by tagging the frames
 * (setparams), and BT709_TAGS then agree with them. Only the tags change:
 * the pixels are the same with or without that last step.
 */

/** Container and encoder colour tags (ffmpeg output options). */
export const BT709_TAGS: readonly string[] = [
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
];

/** The h264_metadata bitstream filter that retags an H.264 stream as BT.709 limited range. */
export const BT709_H264_METADATA =
  'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0';

export interface Bt709FilterOptions {
  /** 'rgb' for RGB frames (PNG), 'yuv' for BT.709 limited-range YUV (a render). */
  from: 'rgb' | 'yuv';
  /** Scale to this size with lanczos; default: keep the size. */
  width?: number;
  height?: number;
  /** Default yuv420p. */
  pixFmt?: 'yuv420p' | 'yuv444p';
}

/** A filter chain that ends in BT.709 limited range, frames tagged. */
export function bt709Filter({
  from,
  width,
  height,
  pixFmt = 'yuv420p',
}: Bt709FilterOptions): string {
  const size = width && height ? `${width}:${height}:` : '';
  const scale =
    from === 'rgb'
      ? `scale=${size}out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd`
      : `scale=${size}flags=lanczos+accurate_rnd+full_chroma_int:in_range=tv:out_range=tv:` +
        'in_color_matrix=bt709:out_color_matrix=bt709';
  return (
    `${scale},format=${pixFmt},` +
    'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'
  );
}
