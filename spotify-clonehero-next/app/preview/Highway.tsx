import {FC} from 'react';
import {Files, ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {ChartResponseEncore} from '@/lib/chartSelection';

export const Highway: FC<{
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioFiles: Files;
}> = ({metadata: _metadata, chart: _chart, audioFiles: _audioFiles}) => {
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
