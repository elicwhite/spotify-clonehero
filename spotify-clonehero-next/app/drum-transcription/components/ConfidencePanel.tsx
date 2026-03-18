'use client';

import {useMemo, useState} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Label} from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {useEditorContext} from '../contexts/EditorContext';
import {noteId} from '../commands';
import {cn} from '@/lib/utils';

interface ConfidencePanelProps {
  className?: string;
}

/**
 * Collapsible panel showing confidence statistics and threshold controls.
 *
 * Features:
 * - Toggle confidence overlay on/off
 * - Adjust confidence threshold slider
 * - Statistics: total notes, high/medium/low confidence counts, reviewed count
 */
export default function ConfidencePanel({className}: ConfidencePanelProps) {
  const {state, dispatch} = useEditorContext();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const stats = useMemo(() => {
    if (!state.chartDoc) {
      return {total: 0, high: 0, medium: 0, low: 0, reviewed: 0, lowIds: 0};
    }

    const track = state.chartDoc.tracks.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!track) {
      return {total: 0, high: 0, medium: 0, low: 0, reviewed: 0, lowIds: 0};
    }

    const total = track.notes.length;
    let high = 0;
    let medium = 0;
    let low = 0;
    let reviewed = 0;

    for (const note of track.notes) {
      const id = noteId(note);
      const conf = state.confidence.get(id);

      if (state.reviewedNoteIds.has(id)) {
        reviewed++;
      }

      if (conf === undefined) {
        // No confidence data: treat as high confidence (manually added)
        high++;
      } else if (conf >= 0.9) {
        high++;
      } else if (conf >= state.confidenceThreshold) {
        medium++;
      } else {
        low++;
      }
    }

    return {total, high, medium, low, reviewed, lowIds: low};
  }, [state.chartDoc, state.confidence, state.confidenceThreshold, state.reviewedNoteIds]);

  if (state.confidence.size === 0) {
    // No confidence data loaded -- don't show the panel
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'rounded-lg border bg-background text-sm',
          className,
        )}>
        {/* Header */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex w-full items-center justify-between px-3 py-2 hover:bg-accent/50 transition-colors rounded-t-lg">
          <div className="flex items-center gap-2">
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-semibold text-xs">ML Confidence</span>
          </div>
          {stats.low > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              {stats.low}
            </span>
          )}
        </button>

        {!isCollapsed && (
          <div className="px-3 pb-3 space-y-3">
            {/* Toggle confidence overlay */}
            <div className="flex items-center justify-between">
              <Label htmlFor="show-confidence" className="text-xs">
                Show overlay
              </Label>
              <Switch
                id="show-confidence"
                checked={state.showConfidence}
                onCheckedChange={checked =>
                  dispatch({type: 'SET_SHOW_CONFIDENCE', show: checked})
                }
              />
            </div>

            {/* Threshold slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Threshold</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {(state.confidenceThreshold * 100).toFixed(0)}%
                </span>
              </div>
              <Slider
                value={[state.confidenceThreshold * 100]}
                min={10}
                max={95}
                step={5}
                onValueChange={v =>
                  dispatch({
                    type: 'SET_CONFIDENCE_THRESHOLD',
                    threshold: v[0] / 100,
                  })
                }
              />
            </div>

            {/* Statistics */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total notes</span>
                <span className="font-mono">{stats.total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
                  High (&ge;90%)
                </span>
                <span className="font-mono">
                  {stats.high.toLocaleString()}
                  {stats.total > 0 && (
                    <span className="text-muted-foreground ml-1">
                      ({((stats.high / stats.total) * 100).toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                  Medium
                </span>
                <span className="font-mono">
                  {stats.medium.toLocaleString()}
                  {stats.total > 0 && (
                    <span className="text-muted-foreground ml-1">
                      ({((stats.medium / stats.total) * 100).toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-500 inline-block" />
                  Low (&lt;{(state.confidenceThreshold * 100).toFixed(0)}%)
                </span>
                <span className="font-mono">
                  {stats.low.toLocaleString()}
                  {stats.total > 0 && (
                    <span className="text-muted-foreground ml-1">
                      ({((stats.low / stats.total) * 100).toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>

              {/* Review progress */}
              <div className="pt-1 border-t">
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Reviewed
                  </span>
                  <span className="font-mono">
                    {stats.reviewed} / {stats.total}
                  </span>
                </div>
                {stats.lowIds > 0 && (
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Low conf. reviewed</span>
                    <span className="font-mono">
                      {/* Count low-confidence notes that are reviewed */}
                      {(() => {
                        if (!state.chartDoc) return 0;
                        const track = state.chartDoc.tracks.find(
                          t =>
                            t.instrument === 'drums' &&
                            t.difficulty === 'expert',
                        );
                        if (!track) return 0;
                        let count = 0;
                        for (const note of track.notes) {
                          const id = noteId(note);
                          const conf = state.confidence.get(id);
                          if (
                            conf !== undefined &&
                            conf < state.confidenceThreshold &&
                            state.reviewedNoteIds.has(id)
                          ) {
                            count++;
                          }
                        }
                        return count;
                      })()}{' '}
                      / {stats.lowIds}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Navigation hint */}
            <p className="text-[10px] text-muted-foreground">
              Press <kbd className="px-1 rounded bg-muted">N</kbd> to jump to
              next low-confidence note.
            </p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
