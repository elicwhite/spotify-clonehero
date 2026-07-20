// Barrel export for components/chart-editor

// Context
export {ChartEditorProvider, useChartEditorContext} from './ChartEditorContext';

// Audio service (sibling to ChartEditorContext — owns the AudioManager instance)
export {
  AudioServiceProvider,
  useAudioServiceContext,
  useAudioManager,
  type AudioServiceContextValue,
} from './AudioServiceContext';

// Headless editor core (reducer, history, selection — @/lib/chart-editor-core)
export {
  getSelectedIds,
  getFirstSelectedId,
  isAnythingSelected,
  selectActiveTrack,
  type ChartEditorState,
  type ChartEditorAction,
  type ChartEditorContextValue,
  type PendingTempoCandidate,
  type ToolMode,
} from '@/lib/chart-editor-core';

// Editor scope (replaces hardcoded expert-drums lookups)
export {
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DEFAULT_GUITAR_EXPERT_SCOPE,
  DEFAULT_VOCALS_SCOPE,
  describeScope,
  entityContextFromScope,
  isTrackScope,
  isVocalsScope,
  resolveScopeTrack,
  trackKeyFromScope,
  trackScope,
  type EditorScope,
  type TrackKey,
} from './scope';

// Capabilities
export {
  DRUM_EDIT_CAPABILITIES,
  ADD_LYRICS_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  type EditorCapabilities,
} from './capabilities';

// Shell component
export {default as ChartEditor} from './ChartEditor';
export type {ChartEditorProps} from './ChartEditor';

// Full-page shell for single-instrument chart-edit pages (/drum-edit, /guitar-edit)
export {default as TrackEditPage} from './TrackEditPage';
export type {TrackEditPageConfig} from './TrackEditPage';

// Sub-components (for advanced composition)
export {default as HighwayEditor} from './HighwayEditor';
export {default as HighwayPreview} from './HighwayPreview';
export type {HighwayRendererHandle} from './HighwayPreview';
export {default as TransportControls} from './TransportControls';
export {default as EditToolbar} from './EditToolbar';
export {default as LeftSidebar} from './LeftSidebar';
export {default as PianoRollTimeline} from './piano-roll/PianoRollTimeline';
export {default as LoopControls} from './LoopControls';
export {default as NoteInspector} from './NoteInspector';
export {default as DifficultyPicker} from './DifficultyPicker';
export {default as ExportDialog} from './ExportDialog';
export type {AudioSource} from './ExportDialog';

// Commands
export {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  ToggleFlagCommand,
  ToggleKickCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  MoveTempoMarkerCommand,
  AddTempoMarkerCommand,
  DeleteTempoMarkerCommand,
  MarkDownbeatCommand,
  UnmarkDownbeatCommand,
  RephaseDownbeatsCommand,
  RepredictTempoCommand,
  CommitTempoCandidateCommand,
  BatchCommand,
  noteId,
  typeToLane,
  laneToType,
  shiftLane,
  defaultFlagsForType,
  type EditCommand,
  type FlagName,
  type TempoGlueMode,
} from './commands';

// Hooks
export {useExecuteCommand, useUndoRedo} from './hooks/useEditCommands';
export {useEditorKeyboard} from './hooks/useEditorKeyboard';
export {useAutoSave, type AutoSaveConfig} from './hooks/useAutoSave';
