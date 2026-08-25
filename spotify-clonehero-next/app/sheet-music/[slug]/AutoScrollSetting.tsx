import {Switch} from '@/components/ui/switch';
import type {AutoScrollState} from '@/lib/sheet-follow/useAutoScroll';
import {cn} from '@/lib/utils';

/**
 * Auto scroll is unfinished, and development-only.
 *
 * Replaying six rehearsal takes it keeps the bar being played on screen 79% to
 * 100% of the time, and no take fails outright — but the threshold deciding when
 * the band is playing has no measured margin, and every number comes from files
 * recorded with ffmpeg rather than through the browser, which captures the same
 * room about 14 dB hotter. It also opens the microphone, which nothing else on
 * this page does.
 *
 * Callers must gate the follower on this too, not just the switch. The setting
 * is persisted, so hiding the control alone would leave anyone who turned it on
 * in development still recording in production.
 */
export const AUTO_SCROLL_ENABLED = process.env.NODE_ENV === 'development';

/** One line saying what the follower is doing. A page that has stopped
 *  following and a page that is following the wrong place look identical from
 *  behind a drum kit, so the state has to be said out loud. */
function statusText(state: AutoScrollState): string {
  switch (state.status) {
    case 'preparing':
      return 'Reading the song and asking for the microphone…';
    case 'listening':
      return 'Listening. Start playing and the page will follow.';
    case 'following':
      return state.confidence >= 0.5
        ? 'Following the band.'
        : 'Following, but this part repeats — position is a guess.';
    case 'error':
      return state.error ?? 'Auto scroll could not start.';
    default:
      return '';
  }
}

export function AutoScrollSetting({
  checked,
  onCheckedChange,
  state,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  state: AutoScrollState;
}) {
  if (!AUTO_SCROLL_ENABLED) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="autoscroll"
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
        <label htmlFor="autoscroll" className="text-sm font-medium">
          Auto scroll
        </label>
      </div>
      {checked && (
        <p
          className={cn(
            'text-xs pl-11',
            state.status === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}>
          {statusText(state)}
        </p>
      )}
    </div>
  );
}
