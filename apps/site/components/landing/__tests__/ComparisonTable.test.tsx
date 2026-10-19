/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen, within} from '@testing-library/react';

import {TooltipProvider} from '@/components/ui/tooltip';

import {ComparisonTable, type ComparisonTableGroup} from '../ComparisonTable';
import type {LandingMetric} from '../StatChip';

function metric(value: string, label: string): LandingMetric {
  return {
    value,
    label,
    prov: {
      script: 'analysis/example/',
      measuredOn: 'the example split',
      asOf: '2026-08-09',
    },
  };
}

function renderTable(
  groups: readonly ComparisonTableGroup[],
  extra: Partial<React.ComponentProps<typeof ComparisonTable>> = {},
) {
  return render(
    <TooltipProvider>
      <ComparisonTable
        caption="Example measurements for this tool and Other."
        rowHeader="Part of the kit"
        columns={['This tool', 'Other']}
        groups={groups}
        {...extra}
      />
    </TooltipProvider>,
  );
}

const peerGroups: ComparisonTableGroup[] = [
  {
    rows: [
      {header: 'Beats', cells: [metric('1.0', 'a'), metric('2.0', 'b')]},
      {header: 'Downbeats', cells: [metric('3.0', 'c'), metric('4.0', 'd')]},
    ],
  },
];

const summaryGroups: ComparisonTableGroup[] = [
  {
    label: 'With an existing tempo map',
    rows: [
      {
        header: 'Whole chart',
        cells: [metric('20.3', 'a'), metric('40.0', 'b')],
        summary: true,
      },
      {header: 'Kick', cells: [metric('7.2', 'c'), metric('13.0', 'd')]},
    ],
  },
  {
    label: 'Starting from audio',
    rows: [
      {
        header: 'Whole chart',
        cells: [metric('34.8', 'e'), metric('54.5', 'f')],
        summary: true,
      },
      {header: 'Kick', cells: [metric('24.4', 'g'), metric('30.3', 'h')]},
    ],
  },
];

describe('ComparisonTable', () => {
  it('gives the table an accessible caption and column headers', () => {
    renderTable(peerGroups);

    const table = screen.getByRole('table', {
      name: 'Example measurements for this tool and Other.',
    });
    expect(
      within(table).getByRole('columnheader', {name: 'Part of the kit'}),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', {name: 'This tool'}),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', {name: 'Other'}),
    ).toBeInTheDocument();
  });

  it('renders every figure with its label reachable to assistive tech', () => {
    renderTable(peerGroups);

    // StatCell exposes "<value>, <label>" so a figure is never announced as a
    // bare number with no referent.
    expect(screen.getByLabelText('1.0, a')).toBeInTheDocument();
    expect(screen.getByLabelText('4.0, d')).toBeInTheDocument();
  });

  it('renders row groups with a spanning header', () => {
    renderTable(summaryGroups);

    const rowGroupHeader = screen.getByRole('rowheader', {
      name: 'With an existing tempo map',
    });
    expect(rowGroupHeader).toHaveAttribute('colspan', '3');
    expect(
      screen.getByRole('rowheader', {name: 'Starting from audio'}),
    ).toBeInTheDocument();
  });

  it('demotes breakdown rows only in a group that has a summary row', () => {
    const {unmount} = renderTable(summaryGroups);

    const summaryRow = screen.getAllByRole('rowheader', {
      name: 'Whole chart',
    })[0]!;
    const breakdownRow = screen.getAllByRole('rowheader', {name: 'Kick'})[0]!;
    expect(summaryRow).toHaveClass('font-medium', 'text-foreground');
    expect(breakdownRow).toHaveClass('text-muted-foreground');
    unmount();

    // A group of peer measurements has no hierarchy to express, so no row is
    // demoted.
    renderTable(peerGroups);
    expect(screen.getByRole('rowheader', {name: 'Beats'})).toHaveClass(
      'text-foreground',
    );
    expect(screen.getByRole('rowheader', {name: 'Downbeats'})).toHaveClass(
      'text-foreground',
    );
  });

  it('rules off every group but the last, whatever the group count', () => {
    // A group's own last row drops its rule, so the `tbody` rule is what
    // separates one group from the next. With three groups, a rule that only
    // ever landed on the first would leave groups 2 and 3 flush together.
    const threeGroups: ComparisonTableGroup[] = ['A', 'B', 'C'].map(label => ({
      label,
      rows: [
        {
          header: `${label} row`,
          cells: [metric('1.0', 'a'), metric('2.0', 'b')],
        },
      ],
    }));
    const {container} = renderTable(threeGroups);

    const bodies = [...container.querySelectorAll('tbody')];
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toHaveClass('border-b');
    expect(bodies[1]).toHaveClass('border-b');
    expect(bodies[2]).not.toHaveClass('border-b');
  });

  it('does not rule off a lone group', () => {
    const {container} = renderTable(peerGroups);

    const bodies = [...container.querySelectorAll('tbody')];
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveClass('border-b');
  });

  it('throws when a row carries the wrong number of cells', () => {
    // Silently dropping or raggedly rendering a column is worse than failing.
    expect(() =>
      renderTable([{rows: [{header: 'Short', cells: [metric('1.0', 'a')]}]}]),
    ).toThrow(/1 cells but there are 2 columns/);
  });

  it('renders the methodology footnote and disclaimer when given', () => {
    renderTable(peerGroups, {
      footnote: 'Other is an open-source tool.',
      disclaimer: 'Confidence intervals have not been calculated.',
    });

    expect(screen.getByText('Other is an open-source tool.')).toBeVisible();
    expect(
      screen.getByText('Confidence intervals have not been calculated.'),
    ).toBeVisible();
  });

  it('omits the footnote and disclaimer slots when not given', () => {
    const {container} = renderTable(peerGroups);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});
