/**
 * @jest-environment jsdom
 */
/**
 * Pins for the Chart Assist "Learn more" copy: it carries no em or en dashes,
 * and a paragraph built from inline nodes renders its link as a real anchor.
 */

import {render, screen} from '@testing-library/react';

import LearnMoreModal from '../LearnMoreModal';
import {LEARN_COPY, type LearnParagraph} from '../learn-copy';

function paragraphText(paragraph: LearnParagraph): string {
  return typeof paragraph === 'string'
    ? paragraph
    : paragraph
        .map(node => (typeof node === 'string' ? node : node.text))
        .join('');
}

describe('LEARN_COPY', () => {
  const entries = Object.entries(LEARN_COPY);

  it.each(entries)('%s has no em or en dashes', (_key, entry) => {
    const text = [entry.title, ...entry.paragraphs.map(paragraphText)].join(
      ' ',
    );
    expect(text).not.toMatch(/[—–]/);
  });

  it.each(entries)('%s has at least one non-empty paragraph', (_key, entry) => {
    expect(entry.paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of entry.paragraphs) {
      expect(paragraphText(paragraph).trim().length).toBeGreaterThan(0);
    }
  });

  it('cites LinkSeg as a link rather than a bare URL', () => {
    const text = paragraphText(LEARN_COPY.sections.paragraphs[0]);
    expect(text).toContain('LinkSeg');
    expect(text).not.toContain('http');
  });
});

describe('LearnMoreModal', () => {
  it('renders inline link nodes as anchors that open in a new tab', () => {
    render(
      <LearnMoreModal
        open
        onOpenChange={() => {}}
        title={LEARN_COPY.sections.title}
        paragraphs={LEARN_COPY.sections.paragraphs}
      />,
    );

    const link = screen.getByRole('link', {name: 'LinkSeg'});
    expect(link).toHaveAttribute('href', 'https://github.com/morgan76/LinkSeg');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('renders plain-string paragraphs unchanged', () => {
    render(
      <LearnMoreModal
        open
        onOpenChange={() => {}}
        title={LEARN_COPY.lyrics.title}
        paragraphs={LEARN_COPY.lyrics.paragraphs}
      />,
    );

    expect(
      screen.getByText(LEARN_COPY.lyrics.paragraphs[0] as string),
    ).toBeInTheDocument();
  });
});
