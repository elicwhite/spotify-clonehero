'use client';

import {useState, useCallback} from 'react';
import {Loader2} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import SongMetadataFields, {type SongMetadataValue} from './SongMetadataFields';

interface SongMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current values, used to seed the form when the dialog opens. */
  value: SongMetadataValue;
  /** Persist the edited metadata. May be async. */
  onSave: (value: SongMetadataValue) => void | Promise<void>;
}

/**
 * Dialog for editing a chart's song / artist / charter. The parent owns the
 * `open` state (e.g. opened by clicking the editor's song-info header) and
 * persists the result via `onSave`.
 */
export default function SongMetadataDialog({
  open,
  onOpenChange,
  value,
  onSave,
}: SongMetadataDialogProps) {
  const [draft, setDraft] = useState<SongMetadataValue>(value);
  const [isSaving, setIsSaving] = useState(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) setDraft(value);
      onOpenChange(next);
    },
    [value, onOpenChange],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave({
        name: draft.name.trim() || 'Untitled',
        artist: draft.artist.trim(),
        charter: draft.charter.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }, [draft, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Song Details</DialogTitle>
          <DialogDescription>
            Edit the song title, artist, and charter. These are saved with the
            chart and used to name the project.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <SongMetadataFields
            value={draft}
            onChange={setDraft}
            idPrefix="song-details"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
