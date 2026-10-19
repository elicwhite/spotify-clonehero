'use client';

import {useCallback, useState} from 'react';
import * as Sentry from '@sentry/nextjs';
import {ClipboardCopy, FolderSearch, Send} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  collectScanDiagnostics,
  type ScanDiagnosticsReport,
} from '@/lib/local-songs-folder/scanDiagnostics';

type State =
  | {phase: 'idle'}
  | {phase: 'running'; visited: number}
  | {phase: 'done'; report: ScanDiagnosticsReport}
  | {phase: 'error'; message: string};

export default function ChartScanDebugClient() {
  const [state, setState] = useState<State>({phase: 'idle'});
  const [sent, setSent] = useState(false);

  const run = useCallback(async () => {
    if (typeof window.showDirectoryPicker !== 'function') {
      setState({
        phase: 'error',
        message:
          'This browser has no folder picker. Use Chrome, Edge, or Opera on a computer.',
      });
      return;
    }

    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({id: 'clone-hero-songs'});
    } catch (error) {
      // Cancelling the picker is not a failure worth reporting.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    setSent(false);
    setState({phase: 'running', visited: 0});
    try {
      const report = await collectScanDiagnostics(handle, visited =>
        setState({phase: 'running', visited}),
      );
      setState({phase: 'done', report});
    } catch (error) {
      setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const json =
    state.phase === 'done' ? JSON.stringify(state.report, null, 2) : '';

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(json);
    toast.success('Report copied. Paste it in the thread or in a message.');
  }, [json]);

  const send = useCallback(() => {
    if (state.phase !== 'done') return;
    Sentry.captureMessage('songs-folder-diagnostic', {
      level: 'info',
      extra: {report: state.report},
      tags: {diagnostic: 'songs-folder', verdict_kind: state.report.verdict},
    });
    setSent(true);
    toast.success('Sent. Thank you.');
  }, [state]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Songs folder diagnostic</CardTitle>
          <CardDescription>
            If the chart scan finds no charts in a folder that Clone Hero plays
            without trouble, this page shows what the browser reports about that
            folder. It reads your <code>song.ini</code> files and nothing else.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The report holds counts, name lengths, file extensions, and the
            spelling of <code>song.ini</code>. It does not hold song names,
            artists, charters, folder names, or any audio or chart data. You see
            the whole report before you send anything.
          </p>
          <div>
            <Button onClick={run} disabled={state.phase === 'running'}>
              <FolderSearch className="mr-2 size-4" />
              {state.phase === 'running'
                ? `Reading… ${state.visited.toLocaleString()} folders`
                : 'Choose your Songs folder'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {state.phase === 'error' && (
        <Card>
          <CardHeader>
            <CardTitle>That did not work</CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {state.phase === 'done' && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
            <CardDescription>{state.report.verdict}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={copy} variant="secondary">
                <ClipboardCopy className="mr-2 size-4" />
                Copy report
              </Button>
              <Button onClick={send} variant="outline" disabled={sent}>
                <Send className="mr-2 size-4" />
                {sent ? 'Sent' : 'Send to the developer'}
              </Button>
            </div>
            <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 text-xs">
              {json}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
