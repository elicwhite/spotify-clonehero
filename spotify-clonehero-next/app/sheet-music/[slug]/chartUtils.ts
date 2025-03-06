import {ParsedChart} from '@/lib/preview/chorus-chart-processing';

export function tickToMs(chart: ParsedChart, tick: number): number {
  // Find the latest tempo event that started at or before 'tick'
  let currentTempo = chart.tempos[0];
  for (let i = 0; i < chart.tempos.length; i++) {
    if (chart.tempos[i].tick <= tick) {
      currentTempo = chart.tempos[i];
    } else {
      break;
    }
  }
  // Calculate the difference in ticks from the tempo's start tick
  const ticksSinceTempo = tick - currentTempo.tick;
  // Determine how many milliseconds each tick represents at the current BPM.
  // BPM to ms per beat conversion: 60000 / BPM, then divided by PPQ.
  const msPerTick = 60000 / currentTempo.beatsPerMinute / chart.resolution;
  // Return the tempo's start time plus the additional ms from ticks elapsed.
  return currentTempo.msTime + ticksSinceTempo * msPerTick;
}
