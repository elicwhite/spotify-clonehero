import React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  FastForward, 
  Rewind, 
  RotateCcw, 
  Music2, 
  Zap, 
  Gauge 
} from 'lucide-react';

interface TempoControlProps {
  tempo: number;
  pitch: number;
  rate: number;
  onTempoChange: (tempo: number) => void;
  onPitchChange: (pitch: number) => void;
  onRateChange: (rate: number) => void;
  onSpeedUp: () => void;
  onSlowDown: () => void;
  onReset: () => void;
}

export default function TempoControl({
  tempo,
  pitch,
  rate,
  onTempoChange,
  onPitchChange,
  onRateChange,
  onSpeedUp,
  onSlowDown,
  onReset,
}: TempoControlProps) {
  const formatTempo = (value: number) => `${value.toFixed(2)}x`;
  const formatPitch = (value: number) => `${value.toFixed(2)}x`;
  const formatRate = (value: number) => `${value.toFixed(2)}x`;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music2 className="h-5 w-5" />
          Tempo Control
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Quick Speed Controls */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSlowDown}
            className="flex-1"
          >
            <Rewind className="h-4 w-4 mr-1" />
            Slow Down
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="flex-1"
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSpeedUp}
            className="flex-1"
          >
            <FastForward className="h-4 w-4 mr-1" />
            Speed Up
          </Button>
        </div>

        {/* Tempo Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="tempo-slider" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Tempo
            </Label>
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
              {formatTempo(tempo)}
            </span>
          </div>
          <Slider
            id="tempo-slider"
            min={0.25}
            max={4.0}
            step={0.01}
            value={[tempo]}
            onValueChange={([value]) => onTempoChange(value)}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.25x</span>
            <span>1.0x</span>
            <span>4.0x</span>
          </div>
        </div>

        {/* Pitch Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="pitch-slider" className="flex items-center gap-2">
              <Music2 className="h-4 w-4" />
              Pitch
            </Label>
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
              {formatPitch(pitch)}
            </span>
          </div>
          <Slider
            id="pitch-slider"
            min={0.25}
            max={4.0}
            step={0.01}
            value={[pitch]}
            onValueChange={([value]) => onPitchChange(value)}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.25x</span>
            <span>1.0x</span>
            <span>4.0x</span>
          </div>
        </div>

        {/* Rate Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="rate-slider" className="flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Rate
            </Label>
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
              {formatRate(rate)}
            </span>
          </div>
          <Slider
            id="rate-slider"
            min={0.25}
            max={4.0}
            step={0.01}
            value={[rate]}
            onValueChange={([value]) => onRateChange(value)}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.25x</span>
            <span>1.0x</span>
            <span>4.0x</span>
          </div>
        </div>

        {/* Current Status */}
        <div className="pt-2 border-t">
          <div className="text-sm text-muted-foreground">
            Current Speed: <span className="font-mono">{formatTempo(tempo)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

