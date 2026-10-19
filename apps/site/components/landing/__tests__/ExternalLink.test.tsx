/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';

import {ExternalLink} from '../ExternalLink';

describe('ExternalLink', () => {
  it('opens in a new tab without leaking the referrer', () => {
    render(<ExternalLink href="https://example.com">Other</ExternalLink>);

    const link = screen.getByRole('link', {name: 'Other'});
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });
});
