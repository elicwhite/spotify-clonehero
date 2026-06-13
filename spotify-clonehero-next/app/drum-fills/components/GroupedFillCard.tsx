'use client';

import {memo, useEffect, useRef, useState} from 'react';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import type {GroupedFill, SrsState} from '@/lib/local-db/drum-fills';
import FillSketch from './FillSketch';
import DifficultyBar from './DifficultyBar';

const SUBDIVISION_LABEL: Record<string, string> = {
  '8ths': '8ths',
  '16ths': '16ths',
  triplets: 'Triplets',
  mixed: 'Mixed',
};

const STATE_BADGE: Record<SrsState, {label: string; className: string}> = {
  new: {label: 'New', className: 'bg-muted text-muted-foreground'},
  learning: {label: 'Learning', className: 'bg-amber-500 text-white'},
  mastered: {label: 'Mastered', className: 'bg-green-600 text-white'},
};

/**
 * One card in the grouped Library: a unique fill pattern (cross-song dedupe)
 * with its representative sketch, an "in N songs" instance badge, an aggregated
 * mastery badge, and the difficulty score. Expands inline to list the per-song
 * instances; practicing opens the representative instance (PracticeView lets the
 * user switch among the group's instances). SRS/mastery is aggregated per
 * pattern, attempts still recorded per concrete instance.
 */
function GroupedFillCard({
  group,
  focused,
  onFocus,
  onPractice,
}: {
  group: GroupedFill;
  focused?: boolean;
  onFocus?: () => void;
  onPractice: (fillId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (focused) ref.current?.focus({preventScroll: true});
  }, [focused]);

  const rep = group.representative;
  const badge = STATE_BADGE[group.state];
  const tempoLabel =
    Math.round(group.tempoMin) === Math.round(group.tempoMax)
      ? `${Math.round(group.tempoMin)} BPM`
      : `${Math.round(group.tempoMin)}–${Math.round(group.tempoMax)} BPM`;

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
            <h3 className="truncate font-semibold" title={rep.song}>
              {rep.song}
            </h3>
            <p
              className="truncate text-sm text-muted-foreground"
              title={rep.artist}>
              {rep.artist}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
              badge.className,
            )}>
            {badge.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <FillSketch
          input={{
            subdivision: rep.subdivision,
            lengthBars: rep.lengthBars,
            voicingTags: rep.voicingTags,
            complexity: rep.complexity,
          }}
        />

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {group.instanceCount > 1 ? (
            <Badge variant="default">in {group.distinctSongs} songs</Badge>
          ) : (
            <Badge variant="secondary">single use</Badge>
          )}
          <Badge variant="secondary">{tempoLabel}</Badge>
          <Badge variant="secondary">
            {SUBDIVISION_LABEL[rep.subdivision] ?? rep.subdivision}
          </Badge>
          <Badge variant="outline">Cx {rep.complexity}</Badge>
          <DifficultyBar score={group.difficultyScore} className="ml-auto" />
        </div>

        {group.instanceCount > 1 && (
          <div>
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline">
              {expanded
                ? 'Hide instances'
                : `Show ${group.instanceCount} instances`}
            </button>
            {expanded && (
              <ul className="mt-1 max-h-32 overflow-y-auto rounded border bg-muted/30 p-1 text-xs">
                {group.songs.map(song => (
                  <li key={song} className="truncate px-1 py-0.5" title={song}>
                    {song}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-end">
          <Button size="sm" onClick={() => onPractice(rep.id)}>
            Practice
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(GroupedFillCard);
