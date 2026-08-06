'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ImageIcon, Loader2, Upload, X} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {cn} from '@/lib/utils';
import {
  ALBUM_ART_ACCEPT,
  ALBUM_ART_SIZE,
  AlbumArtError,
  normalizeAlbumArt,
  type AlbumArtFile,
} from '@/lib/album-art';

/**
 * The album art slot on the Song Details dialog: a drop target that doubles
 * as a file picker, with a preview of whatever the chart will ship.
 *
 * Anything the user gives us is normalized to a {@link ALBUM_ART_SIZE}-square
 * JPEG before it reaches state, so this component never holds a file the
 * package couldn't take. That is also why there is no size warning to show:
 * a 3000×3000 cover is a perfectly good input, it just doesn't stay that way.
 */
export interface AlbumArtFieldProps {
  id: string;
  /** Art the chart currently ships, or null when it has none. */
  value: AlbumArtFile | null;
  /** Called with normalized art, or null to remove it. */
  onChange: (art: AlbumArtFile | null) => void;
  disabled?: boolean | undefined;
}

/**
 * An object URL for `art`, revoked when the art changes or unmounts.
 *
 * Made during render rather than in an effect: the URL is derived from the
 * bytes, and routing it through state would render one frame with no image
 * every time the art changes. The effect exists only to revoke.
 */
function useArtPreview(art: AlbumArtFile | null): string | null {
  const url = useMemo(() => {
    if (!art) return null;
    // Copy into a fresh buffer: the caller's Uint8Array may be a view onto a
    // larger buffer, and Blob would otherwise take the whole thing.
    return URL.createObjectURL(
      new Blob([art.data.slice().buffer as ArrayBuffer], {type: 'image/jpeg'}),
    );
  }, [art]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return url;
}

export default function AlbumArtField({
  id,
  value,
  onChange,
  disabled,
}: AlbumArtFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useArtPreview(value);

  const accept = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setBusy(true);
      try {
        onChange(await normalizeAlbumArt(file));
      } catch (err) {
        // Anything that isn't an `AlbumArtError` is a bug rather than a bad
        // file, so it gets its own wording — the two must not be confusable
        // when someone is working out which one they are looking at.
        setError(
          err instanceof AlbumArtError
            ? err.message
            : 'Something went wrong preparing that image.',
        );
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  return (
    <div className="grid grid-cols-4 items-start gap-4">
      <Label htmlFor={id} className="pt-2 text-right">
        Album Art
      </Label>
      <div className="col-span-3 grid gap-1.5">
        <div className="flex items-center gap-3">
          {/* The drop target IS the preview: one square that either shows the
           *  cover or invites one, so there is never a separate "drop here"
           *  region competing with the thing it would replace. */}
          <button
            id={id}
            type="button"
            disabled={disabled || busy}
            onClick={openPicker}
            onDragOver={e => {
              e.preventDefault();
              if (!disabled && !busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              if (!disabled && !busy) void accept(e.dataTransfer.files[0]);
            }}
            aria-label={value ? 'Replace album art' : 'Add album art'}
            className={cn(
              'relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border text-muted-foreground transition-colors',
              value
                ? 'border-border'
                : 'border-dashed border-muted-foreground/40',
              dragging && 'border-primary bg-primary/5 text-primary',
              disabled
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-primary hover:text-primary',
            )}>
            {preview ? (
              /* An object URL for in-memory bytes, which next/image can't take. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Album art"
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageIcon className="h-6 w-6" />
            )}
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
          </button>

          <div className="grid gap-1.5">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || busy}
                onClick={openPicker}>
                <Upload className="mr-1 h-3.5 w-3.5" />
                {value ? 'Replace' : 'Choose image'}
              </Button>
              {value && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() => {
                    setError(null);
                    onChange(null);
                  }}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Drop an image here or pick one. Anything you give it is cropped
              square and saved as a {ALBUM_ART_SIZE}×{ALBUM_ART_SIZE} JPEG.
            </p>
          </div>
        </div>

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <input
          ref={inputRef}
          type="file"
          accept={ALBUM_ART_ACCEPT}
          className="hidden"
          onChange={e => {
            void accept(e.target.files?.[0]);
            // Clear the input so picking the same file twice re-fires.
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
