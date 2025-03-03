import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {SelectedTrack, setupRenderer} from '@/lib/preview/highway';
import {useSelect} from 'downshift';
import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {FaRegPlayCircle} from 'react-icons/fa';
import throttle from 'throttleit';
import {Files, ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {ChartResponseEncore} from '@/lib/chartSelection';

export const Highway: FC<{
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioFiles: Files;
}> = ({metadata, chart, audioFiles}) => {
  return null;
  // chart.trackData;

  // const sizingRef = useRef<HTMLDivElement>(null);
  // const ref = useRef<HTMLDivElement>(null);
  // const [selectedTrack, setSelectedTrack] = useState<SelectedTrack>({
  //   instrument: chart.trackData[0].instrument,
  //   difficulty: chart.trackData[0].difficulty,
  // });
  // const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);
  // const [songProgress, setSongProgress] = useState(0); // 0 to 1
  // const [playing, setPlaying] = useState(false);

  // useEffect(() => {
  //   const track = chart.trackData.find(
  //     parser =>
  //       parser.instrument == selectedTrack.instrument &&
  //       parser.difficulty == selectedTrack.difficulty,
  //   )!;
  //   if (track == null) {
  //     console.log(
  //       'No track found for',
  //       selectedTrack,
  //       'Only found',
  //       chart.trackData.map(
  //         trackData => `${trackData.instrument} - ${trackData.difficulty}`,
  //       ),
  //     );
  //     return;
  //   }

  //   const renderer = setupRenderer(
  //     metadata,
  //     chart,
  //     sizingRef,
  //     ref,
  //     audioFiles,
  //     (progressPercent: number) => {
  //       setSongProgress(progressPercent);
  //     },
  //     isPlaying => {
  //       setPlaying(isPlaying);
  //     },
  //   );
  //   rendererRef.current = renderer;
  //   renderer.prepTrack(track);
  //   renderer.startRender();

  //   window.renderer = renderer;

  //   return () => {
  //     renderer.destroy();
  //   };
  // }, [metadata, audioFiles, chart, selectedTrack]);

  // // Need to listen to audio context state as well
  // const handlePlayPause = useCallback(() => {
  //   if (rendererRef.current == null) {
  //     return;
  //   }

  //   rendererRef.current.play();
  // }, []);

  // const onInputChange = useMemo(
  //   () =>
  //     throttle(e => {
  //       rendererRef.current?.seek({percent: Number(e.target.value)});
  //     }, 500),
  //   [],
  // );

  // return (
  //   <>
  //     <div className="flex">
  //       <InstrumentDifficultyPicker
  //         chart={chart}
  //         selectedTrack={selectedTrack}
  //         onTrackSelected={setSelectedTrack}
  //       />
  //       <Button
  //         onClick={() => {
  //           ref.current?.requestFullscreen();
  //         }}>
  //         Fullscreen
  //       </Button>
  //     </div>
  //     <input
  //       type="range"
  //       className="w-full"
  //       step={0.001}
  //       min={0}
  //       max={1}
  //       value={songProgress}
  //       onChange={onInputChange}
  //     />
  //     <div className="relative flex-1" ref={sizingRef}>
  //       <div
  //         onClick={handlePlayPause}
  //         className={cn(
  //           playing ? 'opacity-0' : 'opacity-75',
  //           'flex justify-center items-center absolute w-full text-white h-full z-10 transition-opacity duration-300 delay-500 hover:delay-0 hover:duration-500',
  //         )}>
  //         <FaRegPlayCircle className="w-1/3 h-1/3" />
  //       </div>
  //       <div onClick={handlePlayPause} className="absolute" ref={ref}></div>
  //     </div>
  //   </>
  // );
};

function InstrumentDifficultyPicker({
  chart,
  selectedTrack,
  onTrackSelected,
}: {
  chart: ParsedChart;
  selectedTrack: SelectedTrack;
  onTrackSelected: (track: SelectedTrack) => void;
}) {
  const trackTypes = useMemo(() => {
    return chart == null
      ? []
      : chart.trackData.map(parser => ({
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
        className={`absolute w-72 mt-1 shadow-md max-h-80 overflow-scroll p-0 z-20 ${
          !(isOpen && trackTypes.length) && 'hidden'
        }`}
        {...getMenuProps()}>
        {isOpen &&
          trackTypes.map((trackType, index) => (
            <li
              className={cn(
                'flex flex-col cursor-default select-none px-2 py-1.5 text-sm outline-none transition-colors bg-background',
                highlightedIndex === index &&
                  'bg-accent text-accent-foreground',
                selectedTrack === trackType && 'font-bold',
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
