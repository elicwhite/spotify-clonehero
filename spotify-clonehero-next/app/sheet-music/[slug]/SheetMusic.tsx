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
import {PracticeModeConfig} from '@/lib/preview/audioManager';

import {cn} from '@/lib/utils';
import debounce from 'debounce';

type ParsedChart = ReturnType<typeof parseChartFile>;

export default function SheetMusic({
  chart,
  track,
  currentTime,
  showBarNumbers,
  enableColors,
  showLyrics,
  onSelectMeasure,
  triggerRerender,
  practiceModeConfig,
  onPracticeMeasureSelect,
  practiceModeStep,
}: {
  chart: ParsedChart;
  track: ParsedChart['trackData'][0];
  currentTime: number;
  showBarNumbers: boolean;
  enableColors: boolean;
  showLyrics: boolean;
  onSelectMeasure: (time: number) => void;
  triggerRerender: boolean;
  practiceModeConfig: PracticeModeConfig | null;
  onPracticeMeasureSelect: (measureStartMs: number) => void;
  practiceModeStep: 'idle' | 'selectingStart' | 'selectingEnd';
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
      practiceModeConfig,
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
    practiceModeConfig,
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
    
    if (practiceModeConfig) {
      isInPracticeRange = measure.startMs >= practiceModeConfig.startTimeMs && measure.endMs <= practiceModeConfig.endTimeMs;
      isPracticeStart = Math.abs(measure.startMs - practiceModeConfig.startMeasureMs) < 100; // Within 100ms
      isPracticeEnd = Math.abs(measure.endMs - practiceModeConfig.endMeasureMs) < 100; // Within 100ms
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
        isPracticeModeActive={practiceModeConfig !== null && practiceModeConfig.endMeasureMs > 0}
        onClick={() => {
          if (practiceModeStep === 'selectingStart') {
            // For start measure, use the start time
            onPracticeMeasureSelect(measure.startMs);
          } else if (practiceModeStep === 'selectingEnd') {
            // For end measure, use the end time
            onPracticeMeasureSelect(measure.endMs);
          } else {
            // Normal mode - start playing at the measure
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
          highlighted && 'bg-primary/10',
          'hover:bg-muted/40',
          isPracticeStart && 'border-l-4 border-green-500', 
          isPracticeEnd && 'border-r-4 border-green-500',
        )}
        style={style}
        onClick={onClick}
      />
    );
  },
);

MeasureHighlight.displayName = 'MeasureHighlight';
