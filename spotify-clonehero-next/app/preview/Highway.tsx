import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {SelectedTrack, setupRenderer} from '@/lib/preview/highway';
import {ChartParser} from '@/lib/preview/chart-parser';
import {MidiParser} from '@/lib/preview/midi-parser';
import {useSelect} from 'downshift';
import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {FaRegPlayCircle, FaRegPauseCircle} from 'react-icons/fa';

export const Highway: FC<{
  chart: ChartParser | MidiParser;
  audioFiles: ArrayBuffer[];
}> = ({chart, audioFiles}) => {
  const sizingRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [selectedTrack, setSelectedTrack] = useState<SelectedTrack>({
    instrument: chart.trackParsers[0].instrument,
    difficulty: chart.trackParsers[0].difficulty,
  });
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);
  // const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const trackParser = chart.trackParsers.find(
      parser =>
        parser.instrument == selectedTrack.instrument &&
        parser.difficulty == selectedTrack.difficulty,
    )!;
    if (trackParser == null) {
      console.log(
        'No track found for',
        selectedTrack,
        'Only found',
        chart.trackParsers.map(
          trackParser =>
            `${trackParser.instrument} - ${trackParser.difficulty}`,
        ),
      );
      return;
    }

    const renderer = setupRenderer(chart, sizingRef, ref, audioFiles);
    rendererRef.current = renderer;
    renderer.prepTrack(trackParser);
    renderer.startRender();

    return () => {
      renderer.destroy();
    };
  }, [audioFiles, chart, selectedTrack]);

  const handlePlayPause = useCallback(() => {
    if (rendererRef.current == null) {
      return;
    }

    rendererRef.current.play();
  }, []);

  return (
    <>
      <input
        type="range"
        className="w-full hidden"
        step={0.01}
        min={1}
        max={5}
        // defaultValue={settingsRef.current.highwaySpeed}
        // onChange={e => {
        //   settingsRef.current.highwaySpeed = Number(e.target.value);
        // }}
      />
      <div className="flex">
        <InstrumentDifficultyPicker
          chart={chart}
          selectedTrack={selectedTrack}
          onTrackSelected={setSelectedTrack}
        />
        <Button
          onClick={() => {
            ref.current?.requestFullscreen();
          }}>
          Fullscreen
        </Button>
      </div>
      <div className="relative flex-1" ref={sizingRef}>
        {/* <div
          onClick={playPause}
          className="flex justify-center items-center absolute w-full h-full z-10 opacity-0 hover:opacity-75 transition-opacity duration-100 delay-1000 hover:delay-0 hover:duration-500">
          {!playing && <FaRegPlayCircle className="w-1/3 h-1/3" />}
          {playing && <FaRegPauseCircle className="w-1/3 h-1/3" />}
        </div> */}
        <div onClick={handlePlayPause} className="absolute" ref={ref}></div>
      </div>
    </>
  );
};

function InstrumentDifficultyPicker({
  chart,
  selectedTrack,
  onTrackSelected,
}: {
  chart: ChartParser | MidiParser;
  selectedTrack: SelectedTrack;
  onTrackSelected: (track: SelectedTrack) => void;
}) {
  const trackTypes = useMemo(() => {
    return chart == null
      ? []
      : chart.trackParsers.map(parser => ({
          instrument: parser.instrument,
          difficulty: parser.difficulty,
        }));
  }, [chart]);

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    highlightedIndex,
    getItemProps,
  } = useSelect({
    items: trackTypes,
    itemToString: item => {
      if (item == null) {
        return '';
      }
      return `${item.instrument} - ${item.difficulty}`;
    },
    selectedItem: selectedTrack,
    onSelectedItemChange: ({selectedItem: newSelectedItem}) => {
      if (newSelectedItem == null) return;

      onTrackSelected(newSelectedItem);
    },
  });

  return (
    <>
      <div className="w-72 flex flex-col gap-1">
        <div className="flex w-full max-w-sm items-center space-x-2"></div>
        <div
          className="px-3 py-2 border border-input flex justify-between cursor-pointer ring-offset-background"
          {...getToggleButtonProps()}>
          <span>
            {selectedTrack.instrument} - {selectedTrack.difficulty}
          </span>
          <span className="px-2">{isOpen ? <>&#8593;</> : <>&#8595;</>}</span>
        </div>
      </div>
      <ul
        className={`absolute w-72 mt-1 shadow-md max-h-80 overflow-scroll p-0 z-10 ${
          !(isOpen && trackTypes.length) && 'hidden'
        }`}
        {...getMenuProps()}>
        {isOpen &&
          trackTypes.map((trackType, index) => (
            <li
              className={cn(
                highlightedIndex === index &&
                  'bg-accent text-accent-foreground',
                selectedTrack === trackType && 'font-bold',
                'flex flex-col cursor-default select-none rounded-sm px-2 py-1.5 text-sm outline-none transition-colors bg-background',
              )}
              key={`${trackType.instrument}-${trackType.difficulty}`}
              {...getItemProps({item: trackType, index})}>
              <span className="text-sm">
                {trackType.instrument} - {trackType.difficulty}
              </span>
            </li>
          ))}
      </ul>
    </>
  );
}
