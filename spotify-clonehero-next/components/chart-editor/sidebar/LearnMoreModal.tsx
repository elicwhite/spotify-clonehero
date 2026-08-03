'use client';

/**
 * Generic "Learn more" modal for a Chart Assist card (plan 0074 Phase 2,
 * Design C). Every card explains itself in one sentence inline and links to
 * a longer explanation here — the same shell, different copy per feature,
 * so a new card never needs a new modal component.
 */

import {HelpCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface LearnMoreModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One paragraph per `<p>`. Two is the norm (what it does, what to know
   *  before re-running it) — see `LEARN_COPY` in `learn-copy.ts`. */
  paragraphs: readonly string[];
}

export default function LearnMoreModal({
  open,
  onOpenChange,
  title,
  paragraphs,
}: LearnMoreModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div className="space-y-3 text-sm text-muted-foreground">
            {paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </DialogDescription>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
