'use client';

import {memo, useEffect, useRef} from 'react';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import type {FillWithSrs} from '@/lib/drum-fills/db';
import {masteryOf} from '@/lib/drum-fills/library/filterFills';
import FillSketch from './FillSketch';
import DifficultyBar from './DifficultyBar';

/** Compact relative-time label for the last practice attempt. */
function formatLastPracticed(ts: number): string {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  const days = Math.floor(diff / day);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const SUBDIVISION_LABEL: Record<string, string> = {
  '8ths': '8ths',
  '16ths': '16ths',
  triplets: 'Triplets',
  mixed: 'Mixed',
};

const VOICING_LABEL: Record<string, string> = {
  toms: 'Toms',
  'snare-only': 'Snare',
  'kick-woven': 'Kick',
  'crash-end': 'Crash end',
  'cymbal-work': 'Cymbals',
  flams: 'Flams',
  ghosts: 'Ghosts',
};

function MasteryBadge({fill}: {fill: FillWithSrs}) {
  const state = masteryOf(fill);
  const map: Record<string, {label: string; className: string}> = {
    unpracticed: {label: 'New', className: 'bg-muted text-muted-foreground'},
    new: {label: 'New', className: 'bg-muted text-muted-foreground'},
    learning: {label: 'Learning', className: 'bg-amber-500 text-white'},
    mastered: {label: 'Mastered', className: 'bg-green-600 text-white'},
  };
  const {label, className} = map[state] ?? map.unpracticed;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        className,
      )}>
      {label}
    </span>
  );
}

function FillCard({
  fill,
  attemptCount,
  lastAttemptTs,
  focused,
  onFocus,
  onPractice,
}: {
  fill: FillWithSrs;
  attemptCount?: number;
  lastAttemptTs?: number;
  focused?: boolean;
  onFocus?: () => void;
  onPractice: (fillId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.focus({preventScroll: true});
  }, [focused]);

  return (
    <Card
      ref={ref}
      role="gridcell"
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      className={cn(
        'flex flex-col outline-none',
        focused && 'ring-2 ring-ring',
      )}>
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold" title={fill.song}>
              {fill.song}
            </h3>
            <p
              className="truncate text-sm text-muted-foreground"
              title={fill.artist}>
              {fill.artist}
            </p>
          </div>
          <MasteryBadge fill={fill} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <FillSketch
          input={{
            subdivision: fill.subdivision,
            lengthBars: fill.lengthBars,
            voicingTags: fill.voicingTags,
            complexity: fill.complexity,
          }}
        />

        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="secondary">{Math.round(fill.tempoBpm)} BPM</Badge>
          <Badge variant="secondary">
            {fill.lengthBars === 0.5 ? '½ bar' : `${fill.lengthBars} bar`}
          </Badge>
          <Badge variant="secondary">
            {SUBDIVISION_LABEL[fill.subdivision] ?? fill.subdivision}
          </Badge>
          <Badge variant="outline">Cx {fill.complexity}</Badge>
          <DifficultyBar score={fill.difficultyScore} className="ml-auto" />
        </div>

        {fill.voicingTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fill.voicingTags.map(tag => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {VOICING_LABEL[tag] ?? tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {attemptCount
              ? `${attemptCount} attempt${attemptCount === 1 ? '' : 's'}${
                  lastAttemptTs
                    ? ` · ${formatLastPracticed(lastAttemptTs)}`
                    : ''
                }`
              : 'No attempts'}
          </span>
          <Button size="sm" onClick={() => onPractice(fill.id)}>
            Practice
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(FillCard);
