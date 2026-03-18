'use client';

import {useCallback} from 'react';
import {useEditorContext} from '../contexts/EditorContext';
import {chartDocumentToParsedChart} from '@/lib/drum-transcription/chart-io/reader';
import type {EditCommand} from '../commands';

/**
 * Hook that provides a function to execute an EditCommand.
 *
 * It applies the command to the current ChartDocument, re-parses the
 * result via chartDocumentToParsedChart, and dispatches EXECUTE_COMMAND
 * to update both the document and the parsed chart in one reducer step.
 */
export function useExecuteCommand() {
  const {state, dispatch} = useEditorContext();

  const executeCommand = useCallback(
    (command: EditCommand) => {
      const doc = state.chartDoc;
      if (!doc) return;

      const newDoc = command.execute(doc);
      const newChart = chartDocumentToParsedChart(newDoc);

      dispatch({
        type: 'EXECUTE_COMMAND',
        command,
        chart: newChart,
        chartDoc: newDoc,
      });
    },
    [state.chartDoc, dispatch],
  );

  return executeCommand;
}
