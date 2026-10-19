/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render} from '@testing-library/react';
import SketchGrid from '../SketchGrid';
import type {RhythmSketch} from '../../drum-fills/library/rhythmSketch';

const sketch: RhythmSketch = {
  columns: 4,
  cellsPerBar: 2,
  lanes: [
    {voice: 'hat', cells: [true, false, true, false]},
    {voice: 'kick', cells: [true, false, false, false]},
  ],
};

describe('SketchGrid', () => {
  it('renders one labelled row per lane with a tick at each bar start', () => {
    const {container, getByText} = render(<SketchGrid sketch={sketch} />);
    expect(getByText('HH')).toBeInTheDocument();
    expect(getByText('KK')).toBeInTheDocument();
    const rows = container.firstElementChild!.children;
    expect(rows).toHaveLength(2);
    const hatCells = rows[0].lastElementChild!.children;
    expect(hatCells).toHaveLength(4);
    expect(hatCells[0]).toHaveClass('h-2', 'bg-yellow-500');
    expect(hatCells[1]).toHaveClass('bg-muted-foreground/15');
    expect(hatCells[2]).toHaveClass('ml-1');
    expect(hatCells[1]).not.toHaveClass('ml-1');
  });

  it('drops the labels and thins the rows when compact', () => {
    const {container, queryByText} = render(
      <SketchGrid sketch={sketch} compact />,
    );
    expect(queryByText('HH')).toBeNull();
    const cell = container.querySelector('.bg-yellow-500');
    expect(cell).toHaveClass('h-[3px]');
  });
});
