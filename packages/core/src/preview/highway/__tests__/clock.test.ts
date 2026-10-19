import type {AudioManager} from '../../audioManager';
import type {HighwayClock} from '../clock';

describe('HighwayClock', () => {
  it('is satisfied by AudioManager and by a plain object', () => {
    // These assignments are the test: tsgo fails if either source stops
    // fitting the clock the renderer reads.
    const fromAudioManager = (audio: AudioManager): HighwayClock => audio;
    const plain: HighwayClock = {
      chartTime: 1.5,
      chartDelay: 0,
      delay: 0,
      isPlaying: false,
      isInitialized: true,
    };
    expect(typeof fromAudioManager).toBe('function');
    expect(plain.chartTime).toBe(1.5);
  });
});
