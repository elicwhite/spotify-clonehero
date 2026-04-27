// Barrel export for components/chart-editor

// Context
export {
  ChartEditorProvider,
  useChartEditorContext,
  getSelectedIds,
  getFirstSelectedId,
  isAnythingSelected,
  selectActiveTrack,
  type ChartEditorState,
  type ChartEditorAction,
  type ChartEditorContextValue,
  type ToolMode,
} from './ChartEditorContext';

// Editor scope (replaces hardcoded expert-drums lookups)
export {
  DEFAULT_DRUMS_EXPERT_SCOPE,
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
  type EditorCapabilities,
} from './capabilities';

// Shell component
export {default as ChartEditor} from './ChartEditor';
export type {ChartEditorProps} from './ChartEditor';

// Sub-components (for advanced composition)
export {default as HighwayEditor} from './HighwayEditor';
export {default as DrumHighwayPreview} from './DrumHighwayPreview';
export type {HighwayRendererHandle} from './DrumHighwayPreview';
export {default as TransportControls} from './TransportControls';
export {default as WaveformDisplay} from './WaveformDisplay';
export {default as EditToolbar} from './EditToolbar';
export {default as LeftSidebar} from './LeftSidebar';
export {default as TimelineMinimap} from './TimelineMinimap';
export {default as LoopControls} from './LoopControls';
export {default as NoteInspector} from './NoteInspector';
export {default as ExportDialog} from './ExportDialog';
export type {AudioSource} from './ExportDialog';

// Commands
export {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  ToggleFlagCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  BatchCommand,
  noteId,
  typeToLane,
  laneToType,
  shiftLane,
  defaultFlagsForType,
  type EditCommand,
  type FlagName,
} from './commands';

// Hooks
export {useExecuteCommand, useUndoRedo} from './hooks/useEditCommands';
export {useEditorKeyboard} from './hooks/useEditorKeyboard';
export {useAutoSave, type AutoSaveConfig} from './hooks/useAutoSave';
