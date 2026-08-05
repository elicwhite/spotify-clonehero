'use client';

/**
 * Generic "Learn more" modal for a Chart Assist card. Every card explains
 * itself in one sentence inline and links to a longer explanation here: the
 * same shell, different copy per feature, so a new card never needs a new
 * modal component.
 */

import {HelpCircle} from 'lucide-react';
import type {LearnParagraph} from './learn-copy';
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
   *  before re-running it). See `LEARN_COPY` in `learn-copy.ts`. */
  paragraphs: readonly LearnParagraph[];
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
              <p key={i}>
                {typeof paragraph === 'string'
                  ? paragraph
                  : paragraph.map((node, j) =>
                      typeof node === 'string' ? (
                        node
                      ) : (
                        <a
                          key={j}
                          href={node.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-2 hover:text-foreground">
                          {node.text}
                        </a>
                      ),
                    )}
              </p>
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
