'use client';

/**
 * The four highway tool popovers (BPM / TimeSig / Section add / Section rename)
 * collected into one component. Each form's submit handler issues an
 * EditCommand directly; the parent only knows when to *open* a popover
 * (via tool clicks) and when to close it.
 *
 * Each form is its own subcomponent so its `useState` can be seeded from
 * props without an effect (see PopoverState's `initial*` fields). The form
 * mounts when the popover opens and unmounts when it closes — there's no
 * "re-seed running form" path to worry about.
 *
 * Phase 9 will swap each popover-form for a tool plugin; the popover state
 * shape and `<TickPopover>` chrome are expected to survive.
 */

import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import TickPopover from './TickPopover';
import {
  AddBPMCommand,
  AddTimeSignatureCommand,
  AddSectionCommand,
  RenameSectionCommand,
  type EditCommand,
} from '../commands';

export type HighwayPopoverState =
  | {kind: 'bpm'; tick: number; x: number; y: number; initialBpm: number}
  | {kind: 'timesig'; tick: number; x: number; y: number}
  | {kind: 'section'; tick: number; x: number; y: number}
  | {
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

function BpmForm({
  tick,
  x,
  y,
  initialBpm,
  onClose,
  executeCommand,
}: FormCommonProps & {initialBpm: number}) {
  const [bpmInput, setBpmInput] = useState(String(initialBpm));
  const handleSubmit = () => {
    const bpm = parseFloat(bpmInput);
    if (isNaN(bpm) || bpm <= 0) return;
    executeCommand(new AddBPMCommand(tick, bpm));
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
        <label className="text-xs font-medium text-muted-foreground">
          BPM:
        </label>
        <Input
          type="number"
          value={bpmInput}
          onChange={e => setBpmInput(e.target.value)}
          className="h-7 w-20 text-xs"
          autoFocus
          min={1}
          step="any"
        />
        <Button type="submit" size="sm" className="h-7 px-2 text-xs">
          Set
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

function TimeSigForm({tick, x, y, onClose, executeCommand}: FormCommonProps) {
  const [tsNumerator, setTsNumerator] = useState('4');
  const [tsDenominator, setTsDenominator] = useState('4');
  const handleSubmit = () => {
    const num = parseInt(tsNumerator, 10);
    const den = parseInt(tsDenominator, 10);
    if (isNaN(num) || isNaN(den) || num <= 0 || den <= 0) return;
    if (!Number.isInteger(Math.log2(den))) return;
    executeCommand(new AddTimeSignatureCommand(tick, num, den));
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
        <label className="text-xs font-medium text-muted-foreground">TS:</label>
        <Input
          type="number"
          value={tsNumerator}
          onChange={e => setTsNumerator(e.target.value)}
          className="h-7 w-12 text-xs"
          autoFocus
          min={1}
        />
        <span className="text-xs">/</span>
        <Input
          type="number"
          value={tsDenominator}
          onChange={e => setTsDenominator(e.target.value)}
          className="h-7 w-12 text-xs"
          min={1}
        />
        <Button type="submit" size="sm" className="h-7 px-2 text-xs">
          Set
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

function SectionAddForm({
  tick,
  x,
  y,
  onClose,
  executeCommand,
}: FormCommonProps) {
  const [sectionNameInput, setSectionNameInput] = useState('');
  const handleSubmit = () => {
    const name = sectionNameInput.trim();
    if (!name) return;
    executeCommand(new AddSectionCommand(tick, name));
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
          Section:
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
          placeholder="e.g. verse 1"
          autoFocus
        />
        <Button type="submit" size="sm" className="h-7 px-2 text-xs">
          Add
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
  switch (popover.kind) {
    case 'bpm':
      return (
        <BpmForm
          tick={popover.tick}
          x={popover.x}
          y={popover.y}
          initialBpm={popover.initialBpm}
          onClose={onClose}
          executeCommand={executeCommand}
        />
      );
    case 'timesig':
      return (
        <TimeSigForm
          tick={popover.tick}
          x={popover.x}
          y={popover.y}
          onClose={onClose}
          executeCommand={executeCommand}
        />
      );
    case 'section':
      return (
        <SectionAddForm
          tick={popover.tick}
          x={popover.x}
          y={popover.y}
          onClose={onClose}
          executeCommand={executeCommand}
        />
      );
    case 'section-rename':
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
}
