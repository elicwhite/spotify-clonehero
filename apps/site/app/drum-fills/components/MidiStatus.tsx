'use client';

import {useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {cn} from '@/lib/utils';
import {useMidi} from '../contexts/MidiContext';
import CalibrationDialog from './CalibrationDialog';

export default function MidiStatus() {
  const {
    supported,
    ready,
    error,
    devices,
    connectedIds,
    profile,
    calibrationOffsetMs,
    requestAccess,
    loadProfileYaml,
    resetProfile,
  } = useMidi();

  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connectedCount = connectedIds.length;

  const onPickProfile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    loadProfileYaml(text);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-2.5 w-2.5 rounded-full',
            connectedCount > 0
              ? 'bg-green-500'
              : ready
                ? 'bg-amber-500'
                : 'bg-muted-foreground/40',
          )}
        />
        <span className="text-sm font-medium">
          {!supported
            ? 'Web MIDI unavailable'
            : !ready
              ? 'MIDI not connected'
              : connectedCount > 0
                ? `${connectedCount} device${connectedCount === 1 ? '' : 's'} connected`
                : 'No MIDI devices'}
        </span>
      </div>

      {!ready && supported && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void requestAccess()}>
          Connect MIDI
        </Button>
      )}

      {ready && devices.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {devices.map(d => (
            <Badge
              key={d.id}
              variant={connectedIds.includes(d.id) ? 'default' : 'secondary'}
              title={d.manufacturer}>
              {d.name}
            </Badge>
          ))}
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Profile: {profile.deviceName || 'Custom'}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,text/yaml"
          className="hidden"
          onChange={onPickProfile}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}>
          Load profile
        </Button>
        {profile.deviceName !== 'Alesis Surge' && (
          <Button size="sm" variant="ghost" onClick={resetProfile}>
            Reset
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!ready}
          onClick={() => setCalibrationOpen(true)}>
          Calibrate ({calibrationOffsetMs.toFixed(0)} ms)
        </Button>
      </div>

      {error && <p className="w-full text-xs text-red-600">{error}</p>}

      <CalibrationDialog
        open={calibrationOpen}
        onOpenChange={setCalibrationOpen}
      />
    </div>
  );
}
