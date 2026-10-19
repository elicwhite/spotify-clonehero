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

// Shell component
export {default as ChartEditor} from './ChartEditor';
export type {ChartEditorProps} from './ChartEditor';

// Full-page shell for a chart-edit page backed by an OPFS project (/chart-editor)
export {default as TrackEditPage} from './TrackEditPage';
export type {TrackEditPageConfig} from './TrackEditPage';

// Sub-components (for advanced composition)
export {default as HighwayEditor} from './HighwayEditor';
export {default as HighwayLane} from './highway/HighwayLane';
export {default as TransportControls} from './TransportControls';
export {default as LeftSidebar} from './LeftSidebar';
export {default as PianoRollTimeline} from './piano-roll/PianoRollTimeline';
export {default as LoopControls} from './LoopControls';
export {default as NoteInspector} from './NoteInspector';
export {default as ExportDialog} from './ExportDialog';
export type {AudioSource} from './ExportDialog';

// Hooks
export {useExecuteCommand, useUndoRedo} from './hooks/useEditCommands';
export {useEditorKeyboard} from './hooks/useEditorKeyboard';
export {useAutoSave} from './hooks/useAutoSave';
