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

export default function SheetMusic({
  chart,
  track,
  currentTime,
  showBarNumbers,
  enableColors,
  showLyrics,
  onSelectMeasure,
  triggerRerender,
}: {
  chart: ParsedChart;
  track: ParsedChart['trackData'][0];
  currentTime: number;
  showBarNumbers: boolean;
  enableColors: boolean;
  showLyrics: boolean;
  onSelectMeasure: (time: number) => void;
  triggerRerender: boolean;
}) {
  const vexflowContainerRef = useRef<HTMLDivElement>(null);
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
      showLyrics ? chart.lyrics?.filter(lyric => !lyric.text.includes('[')) || [] : [],
      showBarNumbers,
      enableColors,
    );
    setRenderData(data);

    highlightsRef.current = data.map(() => createRef<HTMLButtonElement>());
  }, [measures, showBarNumbers, enableColors, windowWidth, triggerRerender, showLyrics, chart.lyrics, chart.sections]);

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
        onClick={() => {
          onSelectMeasure(measure.startMs / 1000);
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
  onClick?: () => void;
}

const MeasureHighlight = forwardRef<HTMLButtonElement, MeasureHighlightProps>(
  ({style, highlighted, onClick}, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'absolute z-[1] rounded-md border-0 bg-transparent cursor-pointer',
          highlighted && 'bg-primary/10 shadow-md',
          'hover:bg-muted/10 hover:shadow-sm',
        )}
        style={style}
        onClick={onClick}
      />
    );
  },
);

MeasureHighlight.displayName = 'MeasureHighlight';
