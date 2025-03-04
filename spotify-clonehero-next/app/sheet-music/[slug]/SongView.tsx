import {Difficulty} from 'scan-chart';

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
import {
  ArrowLeft,
  Maximize2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Menu,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from 'react';
import useInterval from 'use-interval';
import {ChartResponseEncore} from '@/lib/chartSelection';

import {getBasename} from '@/lib/src-shared/utils';
import {cn} from '@/lib/utils';
import SheetMusic from './SheetMusic';
import {Files, ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {AudioManager} from '@/lib/preview/audioManager';
import CloneHeroRenderer from './CloneHeroRenderer';
import Link from 'next/link';

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
  const [currentPlayback, setCurrentPlayback] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volumeControls, setVolumeControls] = useState<VolumeControl[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const availableDifficulties = getDrumDifficulties(chart);
  const [selectedDifficulty, setSelectedDifficulty] = useState(
    availableDifficulties[0],
  );

  const audioManagerRef = useRef<AudioManager | null>(null);

  useEffect(() => {
    const audioManager = new AudioManager(audioFiles, () => {
      setIsPlaying(false);
    });

    setVolumeControls(
      audioFiles.map(audioFile => ({
        trackName: getBasename(audioFile.fileName),
        volume: 100,
        isMuted: false,
        isSoloed: false,
      })),
    );

    audioManager.ready.then(() => {
      audioManagerRef.current = audioManager;
      window.am = audioManager;
    });

    return () => {
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
    };
  }, [audioFiles]);

  useInterval(
    () => {
      setCurrentPlayback(audioManagerRef.current?.currentTime ?? 0);
    },
    isPlaying ? 100 : null,
  );

  useEffect(() => {
    if (volumeControls.length === 0 || audioManagerRef.current == null) {
      return;
    }

    volumeControls.forEach(control => {
      audioManagerRef.current?.setVolume(control.trackName, control.volume);
    });
  }, [volumeControls, audioManagerRef]);

  const songDuration =
    metadata.song_length == null ? 5 * 60 : metadata.song_length / 1000;

  const difficultySelectorOnSelect = useCallback(
    (selectedDifficulty: string) => {
      setSelectedDifficulty(selectedDifficulty as Difficulty);
    },
    [],
  );

  const volumeSliders = useMemo(() => {
    if (volumeControls.length === 0) {
      return [];
    }

    return volumeControls
      .sort((a, b) => a.trackName.localeCompare(b.trackName))
      .map(control => {
        return (
          <AudioVolume
            key={control.trackName}
            name={control.trackName}
            volume={control.volume}
            isMuted={control.isMuted}
            isSoloed={control.isSoloed}
            onMuteClick={() => {
              if (control.isMuted) {
                setVolumeControls([
                  ...volumeControls.filter(c => c !== control),
                  {
                    ...control,
                    volume: control.previousVolume ?? 100,
                    previousVolume: undefined,
                    isMuted: false,
                  },
                ]);
              } else {
                setVolumeControls([
                  ...volumeControls.filter(c => c !== control),
                  {
                    ...control,
                    volume: 0,
                    previousVolume: control.volume,
                    isMuted: true,
                  },
                ]);
              }
            }}
            onSoloClick={() => {
              const otherControls = volumeControls.filter(c => c !== control);

              if (otherControls.filter(c => c.isSoloed).length > 0) {
                if (control.isSoloed) {
                  setVolumeControls([
                    ...otherControls,
                    {
                      ...control,
                      isSoloed: false,
                      isMuted: true,
                      volume: 0,
                      previousVolume: control.volume,
                    },
                  ]);
                } else {
                  setVolumeControls([
                    ...otherControls,
                    {
                      ...control,
                      isSoloed: true,
                      isMuted: false,
                      volume: control.previousVolume ?? 100,
                      previousVolume: undefined,
                    },
                  ]);
                }

                return;
              }

              if (control.isSoloed) {
                setVolumeControls([
                  ...otherControls.map(c => ({
                    ...c,
                    isMuted: false,
                    previousVolume: undefined,
                    volume: c.previousVolume ?? 100,
                  })),
                  {
                    ...control,
                    isSoloed: false,
                  },
                ]);
              } else {
                setVolumeControls([
                  ...otherControls.map(c => ({
                    ...c,
                    isMuted: true,
                    previousVolume: c.volume,
                    volume: 0,
                  })),
                  {
                    ...control,
                    isSoloed: true,
                  },
                ]);
              }
            }}
            onChange={value => {
              setVolumeControls([
                ...volumeControls.filter(c => c !== control),
                {...control, volume: value},
              ]);
            }}
          />
        );
      });
  }, [volumeControls]);

  // Define reusable control elements
  const backButton = (
    <Link href="/sheet-music">
      <Button variant="ghost" size="icon" className="rounded-full">
        <ArrowLeft className="h-6 w-6" />
      </Button>
    </Link>
  );

  const playPauseButton = (
    <Button
      size="icon"
      variant="secondary"
      className="rounded-full"
      onClick={() => {
        if (!audioManagerRef.current) {
          return;
        }

        if (isPlaying) {
          audioManagerRef.current.pause();
          setIsPlaying(false);
        } else if (!audioManagerRef.current.isInitialized) {
          audioManagerRef.current.play({
            time: 0,
          });
          setIsPlaying(true);
        } else {
          audioManagerRef.current.resume();
          setIsPlaying(true);
        }
      }}>
      {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
    </Button>
  );

  const menuToggleButton = (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
      {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
    </Button>
  );

  return (
    <div className="md:overflow-hidden flex flex-col md:flex-row bg-background relative">
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <div
        className={cn(
          'w-64 border-r p-4 flex flex-col gap-6 bg-background z-40',
          'fixed inset-y-0 left-0 transition-transform duration-300 ease-in-out',
          'md:static md:translate-x-0 md:h-full',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
        <div className="md:flex hidden items-center gap-2">
          {backButton}
          {playPauseButton}
          {/* <Button variant="ghost" size="icon" className="rounded-full">
            <Maximize2 className="h-6 w-6" />
          </Button> */}
        </div>

        <div className="space-y-4 overflow-y-auto">
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

          {volumeSliders}
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
      <div className="flex-1 flex flex-col md:overflow-hidden">
        {/* Mobile controls - sticky on scroll */}
        <div className="md:hidden sticky top-0 z-20 flex items-center gap-2 md:px-4 py-3 border-b bg-background/95 backdrop-blur-sm">
          {backButton}
          {playPauseButton}
          <div className="ml-auto">{menuToggleButton}</div>
        </div>

        <div className="h-12 border-b flex items-center md:px-4 gap-4 md:static sticky top-[60px] z-20 bg-background/95 backdrop-blur-sm">
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
                setIsPlaying(true);
              }
            }}
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatSeconds(currentPlayback)} /{' '}
            {formatSeconds((metadata.song_length || 0) / 1000)}
          </span>
        </div>

        <div className="md:p-8 md:px-4 py-4 flex-1 flex flex-col md:overflow-hidden">
          <h1 className="text-3xl md:text-3xl font-bold mb-4 md:mb-8">
            {metadata.name} by {metadata.artist}
            <span className="block text-lg md:inline md:text-3xl md:ml-1">
              charted by {metadata.charter}
            </span>
          </h1>

          {/* <CloneHeroRenderer
            metadata={metadata}
            chart={chart}
            difficulty={selectedDifficulty}
            audioManager={audioManagerRef.current!}
          /> */}
          <SheetMusic
            currentTime={currentPlayback}
            chart={chart}
            difficulty={selectedDifficulty}
            showBarNumbers={showBarNumbers}
            enableColors={enableColors}
            onSelectMeasure={time => {
              if (audioManagerRef.current == null) {
                return;
              }
              audioManagerRef.current.play({time});

              setIsPlaying(true);
            }}
          />
        </div>
      </div>
    </div>

    // <div key={name} className="space-y-2">
    //   <label className="text-sm font-medium">{name}</label>
    //   <div className="flex items-center gap-2">
    //     <Slider
    //       defaultValue={[volume]}
    //       max={100}
    //       step={1}
    //       className="flex-1"
    //     />
    //     <Button variant="outline" size="icon" className="h-6 w-6">
    //       S
    //     </Button>
    //   </div>
    // </div>

    // <Wrapper>
    //   <FileName>{name}</FileName>
    //   <VolumeControl>
    //     <VolumeSlider value={volume} onChange={onChange} />
    //     <VolumeControlButton
    //       shape="circle"
    //       type={isMuted ? 'primary' : 'default'}
    //       size="small"
    //       icon={<FontAwesomeIcon size="xs" icon={faVolumeMute} />}
    //       onClick={onMuteClick}
    //     />
    //     <VolumeControlButton
    //       shape="circle"
    //       type={isSoloed ? 'primary' : 'default'}
    //       size="small"
    //       icon={<FontAwesomeIcon size="xs" icon={faS} />}
    //       onClick={onSoloClick}
    //     />
    //   </VolumeControl>
    // </Wrapper>
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

export function AudioVolume({
  name,
  volume,
  onChange,
  isMuted,
  isSoloed,
  onSoloClick,
  onMuteClick,
}: {
  name: string;
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  onChange: (value: number) => void;
  onSoloClick: () => void;
  onMuteClick: () => void;
}) {
  return (
    <div key={name} className="space-y-2">
      <label className="text-sm font-medium">{capitalize(name)}</label>
      <div className="flex items-center gap-2">
        <Slider
          defaultValue={[volume]}
          min={0}
          max={1}
          step={0.01}
          className="flex-1"
          onValueChange={values => onChange(values[0])}
        />
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={onMuteClick}>
            {isMuted ? (
              <VolumeX className="h-3 w-3" />
            ) : (
              <Volume2 className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant={isSoloed ? 'secondary' : 'outline'}
            size="icon"
            className="h-6 w-6"
            onClick={onSoloClick}>
            S
          </Button>
        </div>
      </div>
    </div>
  );
}
