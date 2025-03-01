import {Difficulty, parseChartFile} from 'scan-chart';

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
import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  createRef,
} from 'react';
import useInterval from 'use-interval';

import convertToVexFlow from './convertToVexflow';
import {RenderData, renderMusic} from './renderVexflow';
import {ChartResponseEncore} from '@/lib/chartSelection';

import {getBasename} from '@/lib/src-shared/utils';
import {cn} from '@/lib/utils';
import SheetMusic from './SheetMusic';
import {Files, ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {AudioManager} from '@/lib/preview/audioManager';

function getDrumDifficulties(chart: ParsedChart): Difficulty[] {
  return chart.trackData
    .filter(part => part.instrument === 'drums')
    .map(part => part.difficulty);
}

function capitalize(fileName: string): string {
  return fileName[0].toUpperCase() + getBasename(fileName).slice(1);
}

interface VolumeControl {
  trackName: string;
  volume: number;
  previousVolume?: number;
  isMuted: boolean;
  isSoloed: boolean;
}

function formatSeconds(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    Math.floor(seconds % 60),
  ).padStart(2, '0')}`;
}
export default function Renderer({
  metadata,
  chart,
  audioFiles,
}: {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioFiles: Files;
}) {
  const [showBarNumbers, setShowBarNumbers] = useState(false);
  const [enableColors, setEnableColors] = useState(true);
  const [difficulty, setDifficulty] = useState<Difficulty>('expert');
  const [currentPlayback, setCurrentPlayback] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volumeControls, setVolumeControls] = useState<VolumeControl[]>([]);

  const availableDifficulties = getDrumDifficulties(chart);
  const [selectedDifficulty, setSelectedDifficulty] = useState(
    availableDifficulties[0],
  );

  const audioManagerRef = useRef<AudioManager | null>(null);

  useEffect(() => {
    const audioManager = new AudioManager(audioFiles, () => {
      setIsPlaying(false);
    });

    audioManager.ready.then(() => {
      audioManagerRef.current = audioManager;
    });

    setIsPlaying(true);

    return () => {
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
    };
  }, [audioFiles]);

  useInterval(
    () => {
      // Your custom logic here
      setCurrentPlayback(audioManagerRef.current?.currentTime ?? 0);
    },
    isPlaying ? 100 : null,
  );

  const endEvents = chart.endEvents;
  if (endEvents.length !== 1) {
    throw new Error(
      `Song ${metadata.name} by ${metadata.artist} (${metadata.charter}) had more than one end event: ` +
        JSON.stringify(endEvents, null, 2),
    );
  }
  const songDuration = chart.endEvents[0].msTime / 1000;

  const difficultySelectorOnSelect = useCallback(
    (selectedDifficulty: string) => {
      setSelectedDifficulty(selectedDifficulty as Difficulty);
    },
    [],
  );

  const instruments = audioFiles.map(file => ({
    name: capitalize(getBasename(file.fileName)),
    volume: 75,
  }));

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-64 border-r p-4 flex flex-col gap-6">
        <div className="space-y-4">
          {/* <Link href="#">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link> */}
          <Button
            size="icon"
            variant="secondary"
            className="rounded-full"
            onClick={() => {
              if (audioManagerRef.current) {
                audioManagerRef.current.play({
                  time: audioManagerRef.current.currentTime,
                });
                // setIsPlaying(true);
              }
            }}>
            <Play className="h-6 w-6" />
          </Button>
          {/* <Button variant="ghost" size="icon" className="rounded-full">
            <Maximize2 className="h-6 w-6" />
          </Button> */}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Difficulty</label>
            <Select
              defaultValue="expert"
              onValueChange={difficultySelectorOnSelect}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableDifficulties.map(difficulty => (
                  <SelectItem key={difficulty} value={difficulty}>
                    {capitalize(difficulty)}
                  </SelectItem>
                ))}
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
              <Switch
                id="colors"
                checked={enableColors}
                onCheckedChange={setEnableColors}
              />
              <label htmlFor="colors" className="text-sm font-medium">
                Enable colors
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="barnumbers"
                checked={showBarNumbers}
                onCheckedChange={setShowBarNumbers}
              />
              <label htmlFor="barnumbers" className="text-sm font-medium">
                Show bar numbers
              </label>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-auto">
          Special thanks to{' '}
          <a href="https://github.com/tonygoldcrest">@tonygoldcrest</a>&apos;s{' '}
          <a href="https://github.com/tonygoldcrest/drum-hero">drum-hero</a> for
          providing much of this tool.
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-12 border-b flex items-center px-4 gap-4">
          <Slider
            value={[currentPlayback]}
            max={songDuration || 100}
            min={0}
            onValueChange={values => {
              const newTime = values[0];
              setCurrentPlayback(newTime);
              if (audioManagerRef.current) {
                audioManagerRef.current.play({
                  time: newTime,
                });
              }
            }}
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatSeconds(currentPlayback)} /{' '}
            {formatSeconds((metadata.song_length || 0) / 1000)}
          </span>
        </div>

        <div className="p-8 flex-1 flex flex-col overflow-hidden">
          <h1 className="text-3xl font-bold mb-8">
            {metadata.name} by {metadata.artist} charted by {metadata.charter}
          </h1>

          {/* <div className="flex-1"> */}
          <SheetMusic
            // currentTime={currentPlayback}
            chart={chart}
            difficulty={difficulty}
            showBarNumbers={showBarNumbers}
            enableColors={enableColors}
            onSelectMeasure={time => {
              // if (!audioPlayer) {
              //   return;
              // }
              // audioPlayer.start(time);

              setIsPlaying(true);
            }}
          />
          {/* </div> */}
        </div>
      </div>
    </div>
  );
}

interface MeasureHighlightProps {
  style?: React.CSSProperties;
  highlighted?: boolean;
  onClick?: () => void;
}

const MeasureHighlight = forwardRef<HTMLButtonElement, MeasureHighlightProps>(
  ({style, highlighted, onClick}, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'absolute z-[-3] rounded-md border-0 bg-transparent cursor-pointer',
          highlighted && 'bg-primary/10 shadow-md z-[-2]',
          'hover:bg-muted hover:shadow-sm hover:z-[-1]',
        )}
        style={style}
        onClick={onClick}
      />
    );
  },
);

MeasureHighlight.displayName = 'MeasureHighlight';
