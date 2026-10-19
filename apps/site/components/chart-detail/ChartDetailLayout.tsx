'use client';

import {useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, Menu, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

export default function ChartDetailLayout({
  backHref,
  sidebar,
  sidebarControls,
  sidebarFooter,
  forceMobileLayout = false,
  children,
}: {
  backHref: string;
  sidebar: React.ReactNode;
  /** Extra controls shown next to the back button (e.g. play/pause) */
  sidebarControls?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  /** When true, uses mobile-style overlay sidebar even on desktop */
  forceMobileLayout?: boolean;
  children: React.ReactNode;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const backButton = (
    <Link href={backHref}>
      <Button variant="ghost" size="icon" className="rounded-full">
        <ArrowLeft className="h-6 w-6" />
      </Button>
    </Link>
  );

  const menuToggleButton = (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
      {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
    </Button>
  );

  return (
    <div
      className={cn(
        'flex flex-col w-full flex-1',
        !forceMobileLayout && 'md:overflow-hidden',
      )}>
      <div
        className={cn(
          'flex flex-col flex-1 bg-background relative',
          'md:flex-row md:overflow-hidden',
          forceMobileLayout && 'md:overflow-visible',
        )}>
        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className={cn(
              'fixed inset-0 bg-black/50 z-30',
              'md:hidden',
              forceMobileLayout && 'md:block',
            )}
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <div
          className={cn(
            'w-64 border-r p-4 flex flex-col gap-6 bg-background z-40',
            'transition-transform duration-300 ease-in-out',
            'fixed inset-y-0 left-0',
            !forceMobileLayout && 'md:static md:translate-x-0 md:h-full',
            forceMobileLayout && 'md:fixed md:inset-y-0 md:left-0',
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}>
          <div className="md:flex hidden items-center gap-2">
            {backButton}
            {sidebarControls}
          </div>

          <div className="space-y-4 overflow-y-auto flex-1">{sidebar}</div>

          {sidebarFooter}
        </div>

        {/* Main Content */}
        <div
          className={cn(
            'flex-1 flex flex-col',
            'md:overflow-hidden',
            forceMobileLayout && 'md:overflow-visible',
          )}>
          {/* Mobile controls bar */}
          <div
            className={cn(
              'sticky top-0 z-30 flex items-center gap-2 md:px-4 py-3 border-b bg-background/95 backdrop-blur-sm',
              'md:hidden',
              forceMobileLayout && 'md:flex',
            )}>
            {backButton}
            {sidebarControls}
            <div className="ml-auto">{menuToggleButton}</div>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
