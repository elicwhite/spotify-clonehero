'use client';

/**
 * The highway's inline popovers. Sections are the only marker kind the
 * highway draws, so section rename is the only form here; tempo and
 * time-signature values are read and edited in the piano roll's tempo lane.
 * The form's submit handler issues an EditCommand directly; the parent only
 * knows when to *open* the popover (from a double-click on a section) and
 * when to close it.
 *
 * The form is its own subcomponent so its `useState` can be seeded from
 * props without an effect (see the state's `initial*` fields). It mounts
 * when the popover opens and unmounts when it closes — there's no
 * "re-seed running form" path to worry about.
 */

import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import TickPopover from './TickPopover';
import {RenameSectionCommand, type EditCommand} from '../commands';

export type HighwayPopoverState = {
  kind: 'section-rename';
  tick: number;
  x: number;
  y: number;
  initialSectionName: string;
  currentSectionName: string;
};

export interface HighwayPopoversProps {
  popover: HighwayPopoverState | null;
  onClose: () => void;
  executeCommand: (cmd: EditCommand) => void;
}

interface FormCommonProps {
  tick: number;
  x: number;
  y: number;
  onClose: () => void;
  executeCommand: (cmd: EditCommand) => void;
}

function SectionRenameForm({
  tick,
  x,
  y,
  initialSectionName,
  currentSectionName,
  onClose,
  executeCommand,
}: FormCommonProps & {
  initialSectionName: string;
  currentSectionName: string;
}) {
  const [sectionNameInput, setSectionNameInput] = useState(initialSectionName);
  const handleSubmit = () => {
    const newName = sectionNameInput.trim();
    if (!newName || newName === currentSectionName) {
      onClose();
      return;
    }
    executeCommand(new RenameSectionCommand(tick, currentSectionName, newName));
    onClose();
  };
  return (
    <TickPopover x={x} y={y} onClose={onClose} caption={`Tick: ${tick}`}>
      <form
        onSubmit={e => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex items-center gap-1">
        <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          Rename:
        </label>
        <Input
          type="text"
          value={sectionNameInput}
          onChange={e => setSectionNameInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
          }}
          className="h-7 w-32 text-xs"
          autoFocus
        />
        <Button type="submit" size="sm" className="h-7 px-2 text-xs">
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onClose}>
          Cancel
        </Button>
      </form>
    </TickPopover>
  );
}

export default function HighwayPopovers({
  popover,
  onClose,
  executeCommand,
}: HighwayPopoversProps) {
  if (!popover) return null;
  return (
    <SectionRenameForm
      tick={popover.tick}
      x={popover.x}
      y={popover.y}
      initialSectionName={popover.initialSectionName}
      currentSectionName={popover.currentSectionName}
      onClose={onClose}
      executeCommand={executeCommand}
    />
  );
}
