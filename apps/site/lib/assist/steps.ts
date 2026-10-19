/** One step of a multi-step job (a task run, a pipeline stage) and its progress. */
export interface ProcessingStep {
  /** Stable id used as React key; not displayed. */
  key: string;
  /** Bold first line, e.g. "Separating vocal stem". */
  label: string;
  /** Optional muted second line under the label. */
  description?: string | undefined;
  status: 'pending' | 'active' | 'done' | 'error';
  /**
   * 0..1 progress within this step. If omitted on an active step the
   * inner bar renders as indeterminate.
   */
  progress?: number | undefined;
  /**
   * Seconds remaining for the active step. Only displayed when
   * status==='active' && progress > 0.05 && etaSeconds > 5.
   */
  etaSeconds?: number | undefined;
  /** Wall-clock duration once status==='done'. Rendered as " 1.4s ". */
  durationMs?: number | undefined;
  /** Dynamic detail line ("Separating segment 5/34"). Optional. */
  detail?: string | undefined;
}
