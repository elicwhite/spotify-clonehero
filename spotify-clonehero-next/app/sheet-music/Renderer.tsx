import {parseChartFile} from 'scan-chart';

import {Button} from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import Link from 'next/link';
import {ArrowLeft, Maximize2, Play} from 'lucide-react';
import {useState} from 'react';

type ParsedChart = ReturnType<typeof parseChartFile>;

export default function Renderer({
  chart,
  audioFiles,
}: {
  chart: ParsedChart;
  audioFiles: Uint8Array[];
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const duration = 282; // 4:42 in seconds

  const instruments = [
    {name: 'Drums', volume: 75},
    {name: 'Guitar', volume: 75},
    {name: 'Rhythm', volume: 75},
    {name: 'Song', volume: 75},
    {name: 'Vocals', volume: 75},
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Left Sidebar */}
      <div className="w-64 border-r p-4 flex flex-col gap-6">
        <div className="space-y-4">
          <Link href="#">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <Button size="icon" variant="secondary" className="rounded-full">
            <Play className="h-6 w-6" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full">
            <Maximize2 className="h-6 w-6" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Difficulty</label>
            <Select defaultValue="expert">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="expert">Expert</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {instruments.map(instrument => (
            <div key={instrument.name} className="space-y-2">
              <label className="text-sm font-medium">{instrument.name}</label>
              <div className="flex items-center gap-2">
                <Slider
                  defaultValue={[instrument.volume]}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" className="h-6 w-6">
                  S
                </Button>
              </div>
            </div>
          ))}

          <div className="space-y-4 pt-4">
            <div className="flex items-center space-x-2">
              <Switch id="colors" />
              <label htmlFor="colors" className="text-sm font-medium">
                Enable colors
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="barnumbers" />
              <label htmlFor="barnumbers" className="text-sm font-medium">
                Show bar numbers
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <div className="h-12 border-b flex items-center px-4 gap-4">
          <div className="w-full bg-secondary rounded-full h-1">
            <div
              className="bg-primary h-full rounded-full"
              style={{width: `${(currentTime / duration) * 100}%`}}
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {`${String(Math.floor(currentTime / 60)).padStart(2, '0')}:${String(
              Math.floor(currentTime % 60),
            ).padStart(2, '0')} / 04:42`}
          </span>
        </div>

        <div className="p-8 flex-1">
          <h1 className="text-3xl font-bold mb-8">
            The Best Song by The best artist
          </h1>

          {/* Placeholder for sheet music - this div will be populated by sheet music rendering script */}
          <div
            id="sheet-music"
            className="w-full h-[calc(100vh-12rem)] bg-white rounded-lg border"
          />
        </div>
      </div>
    </div>
  );
}
