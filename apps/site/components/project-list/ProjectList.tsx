'use client';

/**
 * The one project list in the app. `/chart-editor` renders every project;
 * `/drum-transcription` renders the ones started from it. Same rows, same
 * open/rename/delete affordances, one filter apart.
 */

import {useState} from 'react';
import {FolderOpen, Music, Pencil, Trash2, Loader2} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {SongMetadataValue} from '@/lib/chart-editor-core';
import type {ProjectOrigin, ProjectRecord} from '@/lib/project-storage/types';

const ORIGIN_LABEL: Record<ProjectOrigin, string> = {
  'chart-editor': 'Chart editor',
  'drum-transcription': 'Drum transcription',
  tempo: 'Tempo mapper',
  'add-lyrics': 'Add lyrics',
  'drum-difficulties': 'Drum difficulty generation',
  'guitar-difficulties': 'Guitar difficulty generation',
};

export interface ProjectListProps {
  records: ReadonlyArray<ProjectRecord>;
  /** The page's own origin, used to decide which rows are foreign. */
  pageOrigin: ProjectOrigin;
  /**
   * Badge rows whose origin differs from `pageOrigin`. Off by default: the
   * chart editor is where every project is edited regardless of where it
   * started, so where it started is not information the list needs to carry.
   * An entrypoint page showing a filtered list can turn it on.
   */
  showOriginBadge?: boolean | undefined;
  loading?: boolean | undefined;
  onOpen: (record: ProjectRecord) => void;
  onRename: (record: ProjectRecord, identity: SongMetadataValue) => void;
  onDelete: (record: ProjectRecord) => void;
}

export default function ProjectList({
  records,
  pageOrigin,
  showOriginBadge = false,
  loading = false,
  onOpen,
  onRename,
  onDelete,
}: ProjectListProps) {
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectRecord | null>(null);
  const [renameValue, setRenameValue] = useState<SongMetadataValue>({
    name: '',
    artist: '',
    charter: '',
  });

  const startRename = (record: ProjectRecord) => {
    setRenameTarget(record);
    setRenameValue({
      name: record.name,
      artist: record.artist,
      charter: record.charter,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">
          Loading projects...
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {records.map(record => (
          <div
            key={record.id}
            data-testid={`project-row-${record.id}`}
            className="flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Music className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{record.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {record.ready ? subtitleFor(record) : 'Needs processing'}
                </p>
              </div>
              {showOriginBadge && record.origin !== pageOrigin && (
                <Badge variant="secondary" className="shrink-0">
                  {ORIGIN_LABEL[record.origin]}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpen(record)}>
                <FolderOpen className="h-4 w-4 mr-1" />
                {record.ready ? 'Open' : 'Resume'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Rename ${record.name}`}
                onClick={() => startRename(record)}>
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${record.name}`}
                onClick={() => setDeleteTarget(record)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={open => {
          if (!open) setRenameTarget(null);
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              These fields name the project and the chart itself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-rename-name">Song</Label>
              <Input
                id="project-rename-name"
                value={renameValue.name}
                onChange={e =>
                  setRenameValue(prev => ({...prev, name: e.target.value}))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-rename-artist">Artist</Label>
              <Input
                id="project-rename-artist"
                value={renameValue.artist}
                onChange={e =>
                  setRenameValue(prev => ({...prev, artist: e.target.value}))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-rename-charter">Charter</Label>
              <Input
                id="project-rename-charter"
                value={renameValue.charter}
                onChange={e =>
                  setRenameValue(prev => ({...prev, charter: e.target.value}))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renameTarget) onRename(renameTarget, renameValue);
                setRenameTarget(null);
              }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.name}&rdquo;
              and all its data from your browser. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget);
                setDeleteTarget(null);
              }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** `Artist · date`, with the date alone when the artist is not known. */
function subtitleFor(record: ProjectRecord): string {
  const date = new Date(record.updatedAt).toLocaleDateString();
  return record.artist ? `${record.artist} · ${date}` : date;
}
