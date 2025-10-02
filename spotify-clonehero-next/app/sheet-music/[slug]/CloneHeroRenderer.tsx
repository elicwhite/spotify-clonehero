import {Difficulty, parseChartFile} from '@eliwhite/scan-chart';
import {
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  createRef,
} from 'react';

import {cn} from '@/lib/utils';

import {SelectedTrack, setupRenderer} from '@/lib/preview/highway';
import {AudioManager} from '@/lib/preview/audioManager';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {useSelect} from 'downshift';

type ParsedChart = ReturnType<typeof parseChartFile>;

export default function CloneHeroRenderer({
  metadata,
  chart,
  track,
  audioManager,
}: {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  track: ParsedChart['trackData'][0];
  audioManager: AudioManager;
}) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const ref = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<SelectedTrack>({
    instrument: chart.trackData[0].instrument,
    difficulty: chart.trackData[0].difficulty,
  });

  useEffect(() => {
    const renderer = setupRenderer(
      metadata,
      chart,
      sizingRef,
      ref,
      audioManager,
    );
    rendererRef.current = renderer;
    renderer.prepTrack(track);
    renderer.startRender();
    return () => {
      renderer.destroy();
    };
  }, [metadata, audioManager, chart, track]);

  return (
    <div className="flex-1 flex-col justify-center bg-white rounded-lg border overflow-y-auto">
      {/* <InstrumentDifficultyPicker
        chart={chart}
        selectedTrack={selectedTrack}
        onTrackSelected={setSelectedTrack}
      /> */}

      <div className="relative h-full" ref={sizingRef}>
        <div ref={ref} className="h-full" />
      </div>
    </div>
  );
}

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
