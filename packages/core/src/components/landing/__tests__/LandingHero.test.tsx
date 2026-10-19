/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';

import {LandingHero} from '../LandingHero';

describe('LandingHero', () => {
  it('renders the title as the page h1', () => {
    render(
      <LandingHero
        eyebrow="Drum transcription"
        title="Turn a song into a first-pass drum chart"
        lede="Placing every drum note by hand is the slow part."
        trust={['Runs in your browser.']}
      />,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Turn a song into a first-pass drum chart',
      }),
    ).toBeInTheDocument();
  });

  it('renders every trust fact as a list item', () => {
    render(
      <LandingHero
        eyebrow="Tempo mapping"
        title="Build a tempo map from the audio"
        lede="This tool writes a first-pass tempo map."
        trust={[
          'All processing happens on your computer.',
          'The first run downloads about 515 MB of model files.',
          'Needs WebGPU, so a recent Chrome or Edge.',
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/515 MB/)).toBeVisible();
  });

  it('renders the illustration and its caption when given', () => {
    render(
      <LandingHero
        eyebrow="Tempo mapping"
        title="Build a tempo map from the audio"
        lede="This tool writes a first-pass tempo map."
        trust={['Runs in your browser.']}
        illustration={<div data-testid="canvas" />}
        caption="Above: a generated tempo map can land off the beat."
      />,
    );

    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByText(/land off the beat/)).toBeVisible();
  });

  it('omits the caption paragraph when there is no caption', () => {
    const {container} = render(
      <LandingHero
        eyebrow="Tempo mapping"
        title="Build a tempo map from the audio"
        lede="This tool writes a first-pass tempo map."
        trust={['Runs in your browser.']}
      />,
    );

    // A captionless hero renders the eyebrow and the lede and stops; the
    // caption slot must not leave an empty paragraph behind the canvas.
    expect(
      screen.getByText('This tool writes a first-pass tempo map.'),
    ).toBeVisible();
    expect(container.querySelectorAll('header > p')).toHaveLength(2);
  });
});
