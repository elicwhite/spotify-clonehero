import type {NoteType} from './types';

// ---------------------------------------------------------------------------
// EventSequence -- cursor-based O(1) amortised lookup for visible notes
// ---------------------------------------------------------------------------

export class EventSequence<
  T extends {msTime: number; msLength: number; type?: NoteType},
> {
  /** Contains the closest events before msTime, grouped by type */
  private lastPrecedingEventIndexesOfType = new Map<
    NoteType | undefined,
    number
  >();
  private lastPrecedingEventIndex = -1;

  /** Assumes `events` are already sorted in `msTime` order. */
  constructor(private events: T[]) {}

  /**
   * Returns the index of the earliest event that is active (or starts at)
   * `startMs`. "Active" means the event started before `startMs` but its
   * sustain tail extends past it.
   *
   * On forward playback this is O(1) amortised because the cursor only
   * advances forward. On seek-backward it resets and re-scans (still fast
   * for the typical case).
   */
  getEarliestActiveEventIndex(startMs: number): number {
    // Detect seek-backward: reset cursor
    if (
      this.lastPrecedingEventIndex !== -1 &&
      startMs < this.events[this.lastPrecedingEventIndex].msTime
    ) {
      this.lastPrecedingEventIndexesOfType = new Map<
        NoteType | undefined,
        number
      >();
      this.lastPrecedingEventIndex = -1;
    }

    // Advance cursor forward
    while (
      this.events[this.lastPrecedingEventIndex + 1] &&
      this.events[this.lastPrecedingEventIndex + 1].msTime < startMs
    ) {
      this.lastPrecedingEventIndexesOfType.set(
        this.events[this.lastPrecedingEventIndex + 1].type,
        this.lastPrecedingEventIndex + 1,
      );
      this.lastPrecedingEventIndex++;
    }

    // Find the earliest event whose sustain tail is still active
    let earliestActiveEventIndex: number | null = null;
    for (const [, index] of this.lastPrecedingEventIndexesOfType) {
      if (this.events[index].msTime + this.events[index].msLength > startMs) {
        if (
          earliestActiveEventIndex === null ||
          earliestActiveEventIndex > index
        ) {
          earliestActiveEventIndex = index;
        }
      }
    }

    return earliestActiveEventIndex === null
      ? this.lastPrecedingEventIndex + 1
      : earliestActiveEventIndex;
  }
}
