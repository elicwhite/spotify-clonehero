import {Difficulty, parseChartFile} from 'scan-chart';
import {
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  createRef,
} from 'react';
import convertToVexFlow from './convertToVexflow';
import {RenderData, renderMusic} from './renderVexflow';

import {cn} from '@/lib/utils';
import debounce from 'debounce';

type ParsedChart = ReturnType<typeof parseChartFile>;

export interface PracticeModeConfig {
  startMeasureMs: number;
  endMeasureMs: number;
  startTimeMs: number; // 2 seconds before start measure
  endTimeMs: number;   // 2 seconds after end measure
}

export default function SheetMusic({
  chart,
  track,
  currentTime,
  showBarNumbers,
  enableColors,
  showLyrics,
  onSelectMeasure,
  triggerRerender,
  practiceMode,
  onPracticeMeasureSelect,
  isPracticeModeActive,
}: {
  chart: ParsedChart;
  track: ParsedChart['trackData'][0];
  currentTime: number;
  showBarNumbers: boolean;
  enableColors: boolean;
  showLyrics: boolean;
  onSelectMeasure: (time: number) => void;
  triggerRerender: boolean;
  practiceMode: PracticeModeConfig | null;
  onPracticeMeasureSelect: (measureStartMs: number) => void;
  isPracticeModeActive: boolean;
}) {
  const vexflowContainerRef = useRef<HTMLDivElement>(null!);
  const [windowWidth, setWindowWidth] = useState<number>(window.innerWidth);
  const highlightsRef = useRef<RefObject<HTMLButtonElement>[]>([]);
  const [highlightedMeasureIndex, setHighlightedMeasureIndex] =
    useState<number>(1);

  const measures = useMemo(() => {
    return convertToVexFlow(chart, track);
  }, [chart, track]);

  const [renderData, setRenderData] = useState<RenderData[]>([]);

  const debouncedOnResize = useMemo(
    () =>
      debounce(() => {
        const width =
          vexflowContainerRef.current?.offsetWidth ?? window.innerWidth;
        setWindowWidth(width);
      }, 50),
    [],
  );

  useEffect(() => {
    window.addEventListener('resize', debouncedOnResize);
    return () => {
      window.removeEventListener('resize', debouncedOnResize);
    };
  }, [debouncedOnResize]);

  useEffect(() => {
    if (!vexflowContainerRef.current) {
      return;
    }

    // Use this to force the sheet music to re-render when the window width changes
    windowWidth;

    if (vexflowContainerRef.current?.children.length > 0) {
      vexflowContainerRef.current.removeChild(
        vexflowContainerRef.current.children[0],
      );
    }

    const data = renderMusic(
      vexflowContainerRef,
      measures,
      chart.sections,
      // https://github.com/YARC-Official/YARG.Core/blob/6b24334cb6b3588d290e1d5f8231ce70314d097c/YARG.Core/MoonscraperChartParser/IO/Midi/MidReader.cs#L299
      showLyrics
        ? (chart as any).lyrics?.filter((lyric: any) => !lyric.text.includes('[')) || []
        : [],
      showBarNumbers,
      enableColors,
    );
    setRenderData(data);

    highlightsRef.current = data.map(() => createRef()) as RefObject<HTMLButtonElement>[];
  }, [
    measures,
    showBarNumbers,
    enableColors,
    windowWidth,
    triggerRerender,
    showLyrics,
    (chart as any).lyrics,
    chart.sections,
  ]);

  useEffect(() => {
    if (!renderData) {
      return;
    }
    const highlightedMeasure = renderData.find(({measure}) => {
      const currentMs = currentTime * 1000;
      return currentMs >= measure.startMs && currentMs < measure.endMs;
    });

    if (!highlightedMeasure) {
      return;
    }

    setHighlightedMeasureIndex(renderData.indexOf(highlightedMeasure));
  }, [currentTime, renderData]);

  useEffect(() => {
    if (highlightsRef.current.length === 0) {
      return;
    }

    highlightsRef.current[highlightedMeasureIndex].current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [highlightedMeasureIndex]);

  const measureHighlights = renderData.map(({measure, stave}, index) => {
    const isHighlighted = index === highlightedMeasureIndex;
    
    // Determine if this measure is in practice mode range
    let isInPracticeRange = false;
    let isPracticeStart = false;
    let isPracticeEnd = false;
    
    if (practiceMode) {
      isInPracticeRange = measure.startMs >= practiceMode.startTimeMs && measure.endMs <= practiceMode.endTimeMs;
      isPracticeStart = Math.abs(measure.startMs - practiceMode.startMeasureMs) < 100; // Within 100ms
      isPracticeEnd = Math.abs(measure.endMs - practiceMode.endMeasureMs) < 100; // Within 100ms
    }

    return (
      <MeasureHighlight
        key={index}
        ref={highlightsRef.current[index]}
        style={{
          top: stave.getY() + 10,
          left: stave.getX() - 5,
          width: stave.getWidth() + 10,
          height: stave.getHeight(),
        }}
        highlighted={isHighlighted}
        isInPracticeRange={isInPracticeRange}
        isPracticeStart={isPracticeStart}
        isPracticeEnd={isPracticeEnd}
        isPracticeModeActive={isPracticeModeActive}
        onClick={() => {
          if (isPracticeModeActive) {
            onPracticeMeasureSelect(measure.startMs);
          } else {
            onSelectMeasure(measure.startMs / 1000);
          }
        }}
      />
    );
  });

  return (
    <div className="flex-1 flex justify-center bg-white rounded-lg border md:overflow-y-auto overflow-x-hidden px-4">
      <div className="relative w-full">
        <div ref={vexflowContainerRef} className="flex h-full w-full" />
        {measureHighlights}
      </div>
    </div>
  );
}

interface MeasureHighlightProps {
  style?: React.CSSProperties;
  highlighted?: boolean;
  isInPracticeRange?: boolean;
  isPracticeStart?: boolean;
  isPracticeEnd?: boolean;
  isPracticeModeActive?: boolean;
  onClick?: () => void;
}

const MeasureHighlight = forwardRef<HTMLButtonElement, MeasureHighlightProps>(
  ({style, highlighted, isInPracticeRange, isPracticeStart, isPracticeEnd, isPracticeModeActive, onClick}, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'absolute z-[1] rounded-md border-0 bg-transparent cursor-pointer transition-all duration-200',
          highlighted && 'bg-primary/10 shadow-md',
          'hover:bg-muted/10 hover:shadow-sm',
          // Practice mode styling
          isPracticeModeActive && !isInPracticeRange && 'opacity-30',
          isInPracticeRange && 'opacity-100',
          isPracticeStart && 'ring-2 ring-green-500 ring-opacity-70',
          isPracticeEnd && 'ring-2 ring-red-500 ring-opacity-70',
        )}
        style={style}
        onClick={onClick}
      />
    );
  },
);

MeasureHighlight.displayName = 'MeasureHighlight';
