/**
 * @jest-environment jsdom
 *
 * Only a mounted chart editor marks the document root compact (plan 0074
 * Phase 7 task 7c); the editor side is tested in
 * `components/chart-editor/__tests__/chart-editor-layout.test.tsx`.
 */
import '@testing-library/jest-dom';
import {render} from '@testing-library/react';
import PrivacyPage from '../page';

it('does not mark a non-editor page compact (/privacy)', () => {
  render(<PrivacyPage />);

  expect(document.documentElement.dataset['density']).toBeUndefined();
});
