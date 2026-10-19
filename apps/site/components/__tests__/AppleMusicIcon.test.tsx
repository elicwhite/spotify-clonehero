/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {render} from '@testing-library/react';

import AppleMusicIcon from '@/components/AppleMusicIcon';

it('uses the official color artwork decoratively by default', () => {
  const {container} = render(<AppleMusicIcon className="h-4 w-4" />);
  const icon = container.querySelector('img');

  expect(icon).toHaveAttribute(
    'src',
    '/assets/apple-music/apple-music-icon-color.svg',
  );
  expect(icon).toHaveAttribute('alt', '');
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon).toHaveClass('h-4', 'w-4');
});

it('uses the official white artwork on Apple-colored surfaces', () => {
  const {container} = render(<AppleMusicIcon variant="white" />);

  expect(container.querySelector('img')).toHaveAttribute(
    'src',
    '/assets/apple-music/apple-music-icon-white.svg',
  );
});
