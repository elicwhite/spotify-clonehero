'use client';

import {useState} from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Slider} from '@/components/ui/slider';
import {Label} from '@/components/ui/label';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

export default function ClickTrackMixer() {
  const [open, setOpen] = useState(false);
  const [volumes, setVolumes] = useState({
    master: 100,
    wholeNote: 100,
    quarterNote: 100,
    eighthNote: 50,
    dottedEighth: 75,
    triplet: 0,
  });

  const handleVolumeChange = (value: number[], key: keyof typeof volumes) => {
    setVolumes(prev => ({...prev, [key]: value[0]}));
  };

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open Volume Mixer</Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center text-xl font-medium">
              Configure Click Track
            </DialogTitle>
          </DialogHeader>

          {/* Desktop layout - grid with vertical sliders */}
          <div className="hidden md:grid md:grid-cols-6 md:gap-4 md:pt-4">
            {/* Master Volume */}
            <VolumeControl
              label="MASTER"
              value={volumes.master}
              onChange={val => handleVolumeChange(val, 'master')}
              orientation="vertical"
              className=""
            />

            {/* Whole Note */}
            <VolumeControl
              label="○"
              value={volumes.wholeNote}
              onChange={val => handleVolumeChange(val, 'wholeNote')}
              isNote
              orientation="vertical"
            />

            {/* Quarter Note */}
            <VolumeControl
              label="♩"
              value={volumes.quarterNote}
              onChange={val => handleVolumeChange(val, 'quarterNote')}
              isNote
              orientation="vertical"
            />

            {/* Eighth Note */}
            <VolumeControl
              label="♪"
              value={volumes.eighthNote}
              onChange={val => handleVolumeChange(val, 'eighthNote')}
              isNote
              orientation="vertical"
            />

            {/* Dotted Eighth Note */}
            <VolumeControl
              label="♪."
              value={volumes.dottedEighth}
              onChange={val => handleVolumeChange(val, 'dottedEighth')}
              isNote
              orientation="vertical"
            />

            {/* Triplet */}
            <VolumeControl
              label="♫"
              value={volumes.triplet}
              onChange={val => handleVolumeChange(val, 'triplet')}
              isNote
              orientation="vertical"
            />
          </div>

          {/* Mobile layout - stacked with horizontal sliders */}
          <div className="flex flex-col space-y-6 pt-4 md:hidden">
            {/* Master Volume */}
            <VolumeControl
              label="MASTER"
              value={volumes.master}
              onChange={val => handleVolumeChange(val, 'master')}
              orientation="horizontal"
            />

            {/* Separator */}
            <div className="h-px w-full bg-border/30 my-2"></div>

            {/* Whole Note */}
            <VolumeControl
              label="○"
              value={volumes.wholeNote}
              onChange={val => handleVolumeChange(val, 'wholeNote')}
              isNote
              orientation="horizontal"
            />

            {/* Quarter Note */}
            <VolumeControl
              label="♩"
              value={volumes.quarterNote}
              onChange={val => handleVolumeChange(val, 'quarterNote')}
              isNote
              orientation="horizontal"
            />

            {/* Eighth Note */}
            <VolumeControl
              label="♪"
              value={volumes.eighthNote}
              onChange={val => handleVolumeChange(val, 'eighthNote')}
              isNote
              orientation="horizontal"
            />

            {/* Dotted Eighth Note */}
            <VolumeControl
              label="♪."
              value={volumes.dottedEighth}
              onChange={val => handleVolumeChange(val, 'dottedEighth')}
              isNote
              orientation="horizontal"
            />

            {/* Triplet */}
            <VolumeControl
              label="♫"
              value={volumes.triplet}
              onChange={val => handleVolumeChange(val, 'triplet')}
              isNote
              orientation="horizontal"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface VolumeControlProps {
  label: string;
  value: number;
  onChange: (value: number[]) => void;
  isNote?: boolean;
  orientation: 'horizontal' | 'vertical';
  className?: string;
}

function VolumeControl({
  label,
  value,
  onChange,
  isNote = false,
  orientation,
  className,
}: VolumeControlProps) {
  const isVertical = orientation === 'vertical';

  return (
    <div
      className={cn(
        'flex items-center',
        isVertical ? 'flex-col' : 'flex-row justify-between w-full gap-4',
        className,
      )}>
      <Label
        className={cn(
          isVertical ? 'mb-2' : 'min-w-16 text-left',
          isNote ? 'text-xl' : 'font-medium',
        )}>
        {label}
      </Label>

      {isVertical ? (
        <div className="h-[200px] flex flex-col items-center justify-center relative">
          {/* Custom track for vertical slider */}
          {/* <div className="absolute h-full w-[2px] bg-muted rounded-full"></div> */}

          {/* Slider component */}
          <Slider
            orientation="vertical"
            value={[value]}
            min={0}
            max={100}
            step={1}
            onValueChange={onChange}
            className="h-full data-[orientation=vertical]:w-50 cursor-pointer"
          />
          <span className="mt-2 text-sm">{value}</span>
        </div>
      ) : (
        <div className="flex-1 flex items-center gap-4">
          {/* Custom track for horizontal slider */}
          <div className="relative flex-1">
            <div className="absolute w-full h-[2px] top-1/2 -translate-y-1/2 bg-muted rounded-full"></div>

            {/* Slider component */}
            <Slider
              value={[value]}
              min={0}
              max={100}
              step={1}
              onValueChange={onChange}
              className="w-full"
            />
          </div>
          <span className="min-w-8 text-right text-sm">{value}</span>
        </div>
      )}
    </div>
  );
}
