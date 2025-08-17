import React from 'react';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  Minus, 
  RotateCcw
} from 'lucide-react';

interface TempoControlProps {
  tempo: number;
  onTempoChange: (tempo: number) => void;
  onReset: () => void;
}

export default function TempoControl({
  tempo,
  onTempoChange,
  onReset,
}: TempoControlProps) {
  const formatTempo = (value: number) => `${value.toFixed(2)}x`;

  const handleIncrement = () => {
    const newTempo = Math.min(tempo + 0.1, 4.0);
    onTempoChange(newTempo);
  };

  const handleDecrement = () => {
    const newTempo = Math.max(tempo - 0.1, 0.25);
    onTempoChange(newTempo);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Speed</span>
        <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
          {formatTempo(tempo)}
        </span>
      </div>
      
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDecrement}
          className="flex-1"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          className="flex-1"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleIncrement}
          className="flex-1"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

