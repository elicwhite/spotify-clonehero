import {ChartFile} from './interfaces';
import MIDIFile from 'midifile';
import {MidiParser} from './midi-parser';

export async function parseMidi(
  midiFileBuffer: ArrayBuffer,
) /*Promise<ChartFile>*/ {
  const midiFile = new MIDIFile(midiFileBuffer);
  const parsed = new MidiParser(midiFile).parse();
  debugger;
}
