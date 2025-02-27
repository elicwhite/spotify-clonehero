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
import convertToVexFlow from './convertToVexflow';
import {RenderData, renderMusic} from './renderVexflow';
import {ChartResponseEncore} from '@/lib/chartSelection';

import {getBasename} from '@/lib/src-shared/utils';
import {cn} from '@/lib/utils';

type ParsedChart = ReturnType<typeof parseChartFile>;

function getDrumDifficulties(chart: ParsedChart): Difficulty[] {
  return chart.trackData
    .filter(part => part.instrument === 'drums')
    .map(part => part.difficulty);
}

function capitalize(fileName: string): string {
  return fileName[0].toUpperCase() + getBasename(fileName).slice(1);
}

export default function SheetMusic({
  chart,
  difficulty,
  showBarNumbers,
  enableColors,
  onSelectMeasure,
}: {
  chart: ParsedChart;
  difficulty: Difficulty;
  showBarNumbers: boolean;
  enableColors: boolean;
  onSelectMeasure: (time: number) => void;
}) {
  const vexflowContainerRef = useRef<HTMLDivElement>(null);

  const highlightsRef = useRef<RefObject<HTMLButtonElement>[]>([]);
  const [highlightedMeasureIndex, setHighlightedMeasureIndex] =
    useState<number>(1);

  const measures = useMemo(() => {
    return convertToVexFlow(chart, difficulty);
  }, [chart, difficulty]);

  const [renderData, setRenderData] = useState<RenderData[]>([]);

  useEffect(() => {
    if (!vexflowContainerRef.current) {
      return;
    }

    if (vexflowContainerRef.current?.children.length > 0) {
      vexflowContainerRef.current.removeChild(
        vexflowContainerRef.current.children[0],
      );
    }

    setRenderData(
      renderMusic(vexflowContainerRef, measures, showBarNumbers, enableColors),
    );
  }, [measures, showBarNumbers, enableColors]);

  // useEffect(() => {
  //   if ( !renderData) { //!midi ||
  //     return;
  //   }

  //   highlightsRef.current = renderData.map(() =>
  //     createRef<HTMLButtonElement>(),
  //   );

  //   const currentTick = midi.header.secondsToTicks(currentTime) ?? 0;
  //   const highlightedMeasure = renderData.find(
  //     ({ measure }) =>
  //       currentTick >= measure.startTick && currentTick < measure.endTick,
  //   );

  //   if (!highlightedMeasure) {
  //     return;
  //   }

  //   setHighlightedMeasureIndex(renderData.indexOf(highlightedMeasure));
  // }, [currentTime, midi, renderData]);

  // useEffect(() => {
  //   if (highlightsRef.current.length === 0) {
  //     return;
  //   }

  //   highlightsRef.current[highlightedMeasureIndex].current?.scrollIntoView({
  //     behavior: 'smooth',
  //     block: 'center',
  //   });
  // }, [highlightedMeasureIndex]);

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
          // if (!midi) {
          //   return;
          // }
          // onSelectMeasure(midi.header.ticksToSeconds(measure.startTick));
        }}
      />
    );
  });

  return (
    <div className="flex-1 flex justify-center bg-white rounded-lg border overflow-y-auto">
      <div className="relative">
        <div ref={vexflowContainerRef} className="h-full" />
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
