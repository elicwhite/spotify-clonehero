'use client';

/**
 * The dashed drop target itself, shared by every "drop a file here" surface so
 * they cannot drift apart. Callers supply the icon, the label and the drop
 * handling; the box, its states and its metrics live here once.
 *
 * `OrDivider` is here too because a drop zone almost always sits above a
 * secondary way to do the same thing (pick a folder, start empty), and the two
 * read as one control only if the separator matches across cards.
 */

import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';

export interface DropZoneShellProps {
  icon: ReactNode;
  label: string;
  isDragging: boolean;
  /** Greyed and non-interactive: either the caller disabled it or a read is
   *  already in flight. */
  inert: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onClick: () => void;
  /** The hidden file input the click opens. */
  children?: ReactNode;
}

export default function DropZoneShell({
  icon,
  label,
  isDragging,
  inert,
  onDrop,
  onDragOver,
  onDragLeave,
  onClick,
  children,
}: DropZoneShellProps) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      className={cn(
        // A fixed min-height rather than padding alone: the two cards sit side
        // by side and their labels wrap to different line counts, so matching
        // padding is not enough to match heights.
        'flex min-h-[9.5rem] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 text-center transition-colors',
        isDragging
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/50',
        inert && 'cursor-not-allowed opacity-50',
      )}>
      <div className="mb-3 text-muted-foreground">{icon}</div>
      <p className="text-sm text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** "or" between a drop zone and the secondary action beneath it. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
