/**
 * @jest-environment jsdom
 */
/**
 * InstrumentIcon (plan 0076 item 9): the shared PNG glyph swapped in for
 * lucide-react icons everywhere the editor iconifies an instrument.
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import InstrumentIcon from '../InstrumentIcon';

describe('InstrumentIcon', () => {
  it.each([
    ['guitar', 'guitar.png'],
    ['bass', 'bass.png'],
    ['drums', 'drums.png'],
    ['vocals', 'vocals.png'],
  ] as const)('renders the %s PNG', (instrument, file) => {
    render(<InstrumentIcon instrument={instrument} />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain(
      encodeURIComponent(`/assets/instruments/${file}`),
    );
  });

  it('is decorative by default (empty alt, no accessible name)', () => {
    render(<InstrumentIcon instrument="guitar" />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes an accessible name when alt is provided', () => {
    render(<InstrumentIcon instrument="drums" alt="Drums" />);
    expect(screen.getByAltText('Drums')).toBeInTheDocument();
  });
});
