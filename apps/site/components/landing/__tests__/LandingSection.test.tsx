/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';

import {LandingSection} from '../Section';

describe('LandingSection', () => {
  it('renders the title as an h2 so pages keep one h1', () => {
    render(<LandingSection title="What it does">body</LandingSection>);

    expect(
      screen.getByRole('heading', {level: 2, name: 'What it does'}),
    ).toBeInTheDocument();
  });

  it('hides a decorative index from assistive tech', () => {
    render(
      <LandingSection index="02" title="What it does">
        body
      </LandingSection>,
    );

    const index = screen.getByText('02');
    expect(index).toHaveAttribute('aria-hidden', 'true');
    // The heading carries the meaning, so the index is not part of its name.
    expect(
      screen.getByRole('heading', {level: 2, name: 'What it does'}),
    ).toBeInTheDocument();
  });

  it('renders no body wrapper for an intro-only section', () => {
    const {container} = render(
      <LandingSection
        title="When it works, and when it doesn't"
        intro="A song that stays in 4/4 usually gets a map you can work with."
      />,
    );

    expect(screen.getByText(/stays in 4\/4/)).toBeVisible();
    // An intro-only section is a supported shape; it must not leave an empty
    // spacer div behind the intro.
    expect(container.querySelector('.mt-6')).toBeNull();
  });

  it('renders a body wrapper when there are children', () => {
    const {container} = render(
      <LandingSection title="What it does">
        <p>body</p>
      </LandingSection>,
    );

    expect(container.querySelector('.mt-6')).not.toBeNull();
  });
});
