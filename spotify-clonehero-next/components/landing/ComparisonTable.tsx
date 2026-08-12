import type {ReactNode} from 'react';

import {StatCell, type LandingMetric} from './StatChip';

/** One measured row: a row header and one figure per compared system. */
interface ComparisonTableRow {
  /** The row header, in the reader's vocabulary ("Kick", "Whole chart"). */
  header: string;
  /** One metric per column, in `columns` order. */
  cells: readonly LandingMetric[];
  /**
   * Marks the row that the other rows in its group break down. A group with
   * a summary row demotes its remaining rows so the hierarchy is visible; a
   * group of peer measurements has no summary row and no demotion.
   */
  summary?: boolean;
}

/** Rows under an optional spanning header ("With an existing tempo map"). */
export interface ComparisonTableGroup {
  label?: string;
  rows: readonly ComparisonTableRow[];
}

/**
 * The measurement table a landing page compares tools in.
 *
 * `docs/landing-page-style-guide.md` §5.2 requires the numbers to be
 * presented and left alone: no verdict sentence, no framing sentence that
 * pre-chews the conclusion, and a methodology footnote a reader can
 * reproduce. The component has slots for `footnote` and `disclaimer` and
 * none for a verdict, which is the cheapest way to keep that true.
 *
 * `caption` is screen-reader-only and says what the table measures; the
 * figures themselves carry their provenance through `StatCell`, so a number
 * is never on screen without its source one hover or focus away (§6).
 */
export function ComparisonTable({
  caption,
  rowHeader,
  columns,
  groups,
  footnote,
  disclaimer,
}: {
  caption: string;
  /** Header for the row-header column ("Part of the kit", "Measurement"). */
  rowHeader: string;
  /** The compared systems, in cell order ("This tool", "ADTOF", ...). */
  columns: readonly string[];
  groups: readonly ComparisonTableGroup[];
  /** Methodology and attribution for the systems named in `columns`. */
  footnote?: ReactNode;
  /** What the measurement does not establish. */
  disclaimer?: ReactNode;
}) {
  // Nothing in the types ties a row's cell count to the column count, and a
  // mismatch degrades quietly: one cell too few silently drops a column, one
  // too many renders a ragged row. Fail loudly in development instead.
  if (process.env.NODE_ENV !== 'production') {
    for (const group of groups) {
      for (const row of group.rows) {
        if (row.cells.length !== columns.length) {
          throw new Error(
            `ComparisonTable: row "${row.header}" has ${row.cells.length} cells but there are ${columns.length} columns.`,
          );
        }
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="py-2 pr-4 text-left font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                {rowHeader}
              </th>
              {columns.map(head => (
                <th
                  key={head}
                  scope="col"
                  className="py-2 pl-4 text-right font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group, groupIndex) => {
            const demoteRows = group.rows.some(row => row.summary);
            // A group's own last row drops its rule, so the rule that
            // separates one group from the next belongs to the `tbody`. Every
            // group but the last needs one.
            const separated = groupIndex < groups.length - 1;
            return (
              <tbody
                key={group.label ?? groupIndex}
                className={separated ? 'border-b border-border/60' : undefined}>
                {group.label ? (
                  <tr className="border-b border-border/60 bg-muted/40">
                    <th
                      scope="rowgroup"
                      colSpan={columns.length + 1}
                      className="py-2 text-left text-xs font-medium text-foreground">
                      {group.label}
                    </th>
                  </tr>
                ) : null}
                {group.rows.map(row => (
                  <tr
                    key={row.header}
                    className="border-b border-border/60 last:border-b-0">
                    <th
                      scope="row"
                      className={
                        row.summary
                          ? 'py-2 pr-4 text-left font-medium text-foreground'
                          : demoteRows
                            ? 'py-2 pr-4 text-left font-normal text-muted-foreground'
                            : 'py-2 pr-4 text-left font-normal text-foreground'
                      }>
                      {row.header}
                    </th>
                    {row.cells.map((metric, cellIndex) => (
                      <td
                        key={columns[cellIndex] ?? cellIndex}
                        className="py-2 pl-4 text-right">
                        <StatCell metric={metric} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      {footnote ? (
        <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          {footnote}
        </p>
      ) : null}
      {disclaimer ? (
        <p className="max-w-2xl pt-7 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {disclaimer}
        </p>
      ) : null}
    </div>
  );
}
