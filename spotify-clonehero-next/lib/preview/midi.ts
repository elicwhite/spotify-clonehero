import {ChartFile} from './interfaces';
import MIDIFile from 'midifile';

export async function parseMidi(
  midiFileBuffer: ArrayBuffer,
) /*Promise<ChartFile>*/ {
  const midiFile = new MIDIFile(midiFileBuffer);
}
