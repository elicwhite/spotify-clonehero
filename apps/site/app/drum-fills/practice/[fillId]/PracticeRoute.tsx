'use client';

import {useRouter} from 'next/navigation';
import PracticeView from '../../components/PracticeView';

/**
 * Single-fill practice (`/drum-fills/practice/[fillId]`). Full-bleed practice
 * surface. Exit returns to the previous surface, falling back to the Library.
 */
export default function PracticeRoute({fillId}: {fillId: string}) {
  const router = useRouter();

  const exit = () => {
    if (window.history.length > 1) router.back();
    else router.push('/drum-fills/library');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PracticeView fillId={fillId} onExit={exit} enableInstanceSwitcher />
    </div>
  );
}
