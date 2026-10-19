/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render} from '@testing-library/react';
import SketchGrid from '@musiccharts/core/components/SketchGrid';
import {
  buildRhythmSketch,
  type SketchInput,
} from '@musiccharts/core/drum-fills/library/rhythmSketch';
import FillSketch from '../FillSketch';

const input: SketchInput = {
  subdivision: '16ths',
  lengthBars: 1,
  voicingTags: ['snare', 'tom'],
  complexity: 3,
};

describe('FillSketch', () => {
  it('renders the shared SketchGrid for the taxonomy-derived sketch', () => {
    const {container} = render(<FillSketch input={input} />);
    const expected = render(
      <SketchGrid sketch={buildRhythmSketch(input)} />,
    ).container;
    const wrapper = container.firstElementChild!;
    expect(wrapper).toHaveClass('rounded-md', 'border');
    expect(wrapper.innerHTML).toBe(expected.innerHTML);
    expect(wrapper.innerHTML).toContain('SN');
  });
});
