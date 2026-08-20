/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen} from '@testing-library/react';

import {ScrollToStartCta} from '../ScrollToStartCta';
import {ToolEntryCard} from '../ToolEntryCard';
import {START_SECTION_ID, ToolEntrySection} from '../ToolEntrySection';

describe('ToolEntrySection', () => {
  it('carries the id the footer CTA scrolls to', () => {
    const {container} = render(
      <ToolEntrySection title="Start a song" intro="Drop in an audio file.">
        <div data-testid="entry" />
      </ToolEntrySection>,
    );

    expect(container.querySelector(`#${START_SECTION_ID}`)).not.toBeNull();
    expect(screen.getByTestId('entry')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {level: 2, name: 'Start a song'}),
    ).toBeInTheDocument();
  });
});

describe('ScrollToStartCta', () => {
  it('scrolls the tool-entry section into view', () => {
    render(
      <>
        <ToolEntrySection title="Start a song">
          <div />
        </ToolEntrySection>
        <ScrollToStartCta>Open a song</ScrollToStartCta>
      </>,
    );

    const target = document.getElementById(START_SECTION_ID)!;
    const scrollIntoView = jest.fn();
    target.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByRole('button', {name: 'Open a song'}));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });
});

describe('ToolEntryCard', () => {
  it('renders description as the header and the footnote after the controls', () => {
    render(
      <ToolEntryCard
        description="What the tool builds."
        footnote="Runs locally.">
        <div data-testid="controls" />
      </ToolEntryCard>,
    );

    expect(screen.getByText('What the tool builds.')).toBeInTheDocument();
    expect(screen.getByTestId('controls')).toBeInTheDocument();
    expect(screen.getByText('Runs locally.')).toBeInTheDocument();
  });

  it('pads its own top when there is no description header', () => {
    // CardContent assumes a CardHeader above it (p-6 pt-0); a headerless
    // entry card must not inherit that assumption. /add-lyrics hand-wrote
    // `pt-6` at the call site before the card owned this.
    const {container} = render(
      <ToolEntryCard>
        <div data-testid="controls" />
      </ToolEntryCard>,
    );

    const content = screen.getByTestId('controls').parentElement!;
    expect(content.className).toContain('pt-6');
    expect(container.querySelector('.pt-0')).toBeNull();
  });
});
