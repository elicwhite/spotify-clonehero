/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen} from '@testing-library/react';

import {ExternalLink} from '../ExternalLink';
import {ScrollToStartCta} from '../ScrollToStartCta';
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

describe('ExternalLink', () => {
  it('opens in a new tab without leaking the referrer', () => {
    render(<ExternalLink href="https://example.com">Other</ExternalLink>);

    const link = screen.getByRole('link', {name: 'Other'});
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });
});
