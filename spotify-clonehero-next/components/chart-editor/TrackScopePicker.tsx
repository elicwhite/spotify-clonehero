'use client';

import {useMemo, useState} from 'react';
import {ChevronDown, ChevronRight, Eye, EyeOff, Plus} from 'lucide-react';
import type {Difficulty, ParsedTrackData} from '@/lib/chart-edit';
import {Button} from '@/components/ui/button';
import {useChartEditorContext} from './ChartEditorContext';
import {useExecuteCommand} from './hooks/useEditCommands';
import {AddTrackCommand} from './commands';
import {isTrackScope, trackKeyId} from './scope';
import {
  availableTrackKeys,
  preferredTrackKey,
  SUPPORTED_TRACK_INSTRUMENTS,
  TRACK_DIFFICULTIES,
  type SupportedTrackInstrument,
  type SupportedTrackKey,
} from '@/lib/chart-editor-core/trackInventory';

export type HighwayInstrument = SupportedTrackInstrument;
export type HighwayTrackKey = SupportedTrackKey;

const INSTRUMENT_LABELS: Record<HighwayInstrument, string> = {
  guitar: 'Guitar',
  bass: 'Bass',
  drums: 'Drums',
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  expert: 'Expert',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};
const DIFFICULTY_BADGES: Record<Difficulty, string> = {
  expert: 'X',
  hard: 'H',
  medium: 'M',
  easy: 'E',
};

/** Return supported chart tracks in stable instrument/difficulty order. */
export const availableHighwayTracks = availableTrackKeys;

/**
 * Initial highway choice for the unified editor:
 * guitar Expert, then drums Expert, then any Expert, then the first track.
 */
export function findPreferredHighwayTrackKey(
  trackData: ParsedTrackData[],
): HighwayTrackKey | undefined {
  return preferredTrackKey(trackData);
}

/** Resolve the preferred key back to the parser's track object. */
export function findPreferredHighwayTrack(
  trackData: ParsedTrackData[],
): ParsedTrackData | undefined {
  const preferred = findPreferredHighwayTrackKey(trackData);
  return preferred
    ? trackData.find(
        track =>
          track.instrument === preferred.instrument &&
          track.difficulty === preferred.difficulty,
      )
    : undefined;
}

/**
 * Unified sidebar inventory for the chart editor. Instrument groups are
 * collapsible; difficulty rows own the piano-roll View toggle while clicking
 * a difficulty label changes the highway/inspector focus.
 */
export default function TrackScopePicker() {
  const {state, dispatch} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const [expanded, setExpanded] = useState<Set<HighwayInstrument>>(
    () => new Set(),
  );
  const [addMenu, setAddMenu] = useState<
    | {kind: 'instrument'}
    | {kind: 'difficulty'; instrument: HighwayInstrument}
    | null
  >(null);

  const tracks = useMemo(
    () => availableHighwayTracks(state.chartDoc?.parsedChart.trackData ?? []),
    [state.chartDoc],
  );
  const instruments = useMemo(
    () =>
      SUPPORTED_TRACK_INSTRUMENTS.map(instrument => ({
        instrument,
        tracks: tracks.filter(track => track.instrument === instrument),
      })).filter(group => group.tracks.length > 0),
    [tracks],
  );
  const missingInstruments = SUPPORTED_TRACK_INSTRUMENTS.filter(
    instrument => !instruments.some(group => group.instrument === instrument),
  );

  if (!isTrackScope(state.activeScope) || instruments.length === 0) return null;

  const focusTrack = (track: HighwayTrackKey) => {
    dispatch({
      type: 'SET_ACTIVE_SCOPE',
      scope: {kind: 'track', track},
    });
  };

  const toggleView = (track: HighwayTrackKey) => {
    const visible = state.visibleTrackKeys.has(trackKeyId(track));
    dispatch({type: 'SET_TRACK_VISIBILITY', track, visible: !visible});
  };

  const addTrack = (track: HighwayTrackKey) => {
    executeCommand(new AddTrackCommand(track));
    dispatch({
      type: 'SET_ACTIVE_SCOPE',
      scope: {kind: 'track', track},
    });
    dispatch({type: 'SET_TRACK_VISIBILITY', track, visible: true});
    setExpanded(current => new Set(current).add(track.instrument));
    setAddMenu(null);
  };

  return (
    <div className="space-y-2 pt-4 border-t">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Instruments</span>
        <span className="text-[10px] text-muted-foreground">View</span>
      </div>

      <div className="space-y-1">
        {instruments.map(group => {
          const isExpanded = expanded.has(group.instrument);
          const missingDifficulties = TRACK_DIFFICULTIES.filter(
            difficulty =>
              !group.tracks.some(track => track.difficulty === difficulty),
          );
          return (
            <div
              key={group.instrument}
              className="rounded-md border bg-muted/20">
              <div className="flex items-center gap-1 px-1.5 py-1">
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${INSTRUMENT_LABELS[group.instrument]}`}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpanded(current => {
                      const next = new Set(current);
                      if (next.has(group.instrument))
                        next.delete(group.instrument);
                      else next.add(group.instrument);
                      return next;
                    })
                  }>
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                <span className="min-w-0 flex-1 text-xs font-medium">
                  {INSTRUMENT_LABELS[group.instrument]}
                </span>
                <div className="flex items-center gap-0.5">
                  {group.tracks.map(track => (
                    <button
                      key={track.difficulty}
                      type="button"
                      className="rounded px-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`${INSTRUMENT_LABELS[group.instrument]} ${DIFFICULTY_LABELS[track.difficulty]}`}
                      onClick={() => focusTrack(track)}>
                      {DIFFICULTY_BADGES[track.difficulty]}
                    </button>
                  ))}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t px-2 py-1">
                  {group.tracks.map(track => {
                    const visible = state.visibleTrackKeys.has(
                      trackKeyId(track),
                    );
                    const focused =
                      state.activeScope.kind === 'track' &&
                      trackKeyId(state.activeScope.track) === trackKeyId(track);
                    return (
                      <div
                        key={track.difficulty}
                        className="flex items-center gap-2 py-1">
                        <button
                          type="button"
                          className={`min-w-0 flex-1 truncate text-left text-xs ${focused ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                          onClick={() => focusTrack(track)}>
                          {DIFFICULTY_LABELS[track.difficulty]}
                        </button>
                        <Button
                          type="button"
                          variant={visible ? 'secondary' : 'ghost'}
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[10px]"
                          aria-pressed={visible}
                          onClick={() => toggleView(track)}>
                          {visible ? (
                            <Eye className="h-3 w-3" />
                          ) : (
                            <EyeOff className="h-3 w-3" />
                          )}
                          View
                        </Button>
                      </div>
                    );
                  })}
                  <div className="relative pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={missingDifficulties.length === 0}
                      className="h-7 w-full justify-start gap-1 px-1.5 text-xs text-muted-foreground"
                      onClick={() =>
                        setAddMenu(current =>
                          current?.kind === 'difficulty' &&
                          current.instrument === group.instrument
                            ? null
                            : {
                                kind: 'difficulty',
                                instrument: group.instrument,
                              },
                        )
                      }>
                      <Plus className="h-3 w-3" /> Add Difficulty
                    </Button>
                    {addMenu?.kind === 'difficulty' &&
                      addMenu.instrument === group.instrument && (
                        <div className="absolute left-0 right-0 z-40 mt-1 rounded-md border bg-popover p-1 shadow-md">
                          {missingDifficulties.map(difficulty => (
                            <button
                              key={difficulty}
                              type="button"
                              className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                              onClick={() =>
                                addTrack({
                                  instrument: group.instrument,
                                  difficulty,
                                })
                              }>
                              {DIFFICULTY_LABELS[difficulty]}
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={missingInstruments.length === 0}
          className="h-8 w-full justify-start gap-1.5 text-xs"
          onClick={() =>
            setAddMenu(current =>
              current?.kind === 'instrument' ? null : {kind: 'instrument'},
            )
          }>
          <Plus className="h-3.5 w-3.5" /> Add Instrument
        </Button>
        {addMenu?.kind === 'instrument' && (
          <div className="absolute bottom-full left-0 right-0 z-40 mb-1 rounded-md border bg-popover p-1 shadow-md">
            {missingInstruments.map(instrument => (
              <button
                key={instrument}
                type="button"
                className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => addTrack({instrument, difficulty: 'expert'})}>
                {INSTRUMENT_LABELS[instrument]} · Expert
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
