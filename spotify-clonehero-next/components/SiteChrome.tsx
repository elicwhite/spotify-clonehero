'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {createPortal} from 'react-dom';
import {usePathname} from 'next/navigation';
import EditorAppIcon from '@/components/chart-editor/EditorAppIcon';

/**
 * Routes whose pages render (or lead into) the chart editor shell
 * (`ChartEditor`), per plan 0074 Phase 7 task 7b's route audit: every page
 * that mounts `ChartEditor` somewhere in its tree, either directly or via a
 * picker/upload screen that precedes it. These routes swap the site nav for
 * the prototype's one slim editor header row.
 */
const EDITOR_ROUTES = [
  '/chart-editor',
  '/drum-difficulties',
  '/guitar-difficulties',
  '/drum-transcription',
  '/tempo',
  '/add-lyrics',
  '/preview',
] as const;

function isEditorRoute(pathname: string): boolean {
  return EDITOR_ROUTES.some(
    route => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * The compact header row's content slot. On an editor route the row always
 * exists (see `SiteHeader`), so exactly one header is on screen from the
 * first paint; a page with its own header content fills the slot rather than
 * rendering a competing second row.
 */
interface EditorChrome {
  /** True while the route renders the compact editor header row. */
  hasEditorHeader: boolean;
  /** The row's content element, once mounted. */
  headerSlot: HTMLElement | null;
  setHeaderSlot: (el: HTMLElement | null) => void;
}

const EditorChromeContext = createContext<EditorChrome | null>(null);

export function EditorChromeProvider({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const hasEditorHeader = isEditorRoute(pathname ?? '');
  const value = useMemo(
    () => ({hasEditorHeader, headerSlot, setHeaderSlot}),
    [hasEditorHeader, headerSlot],
  );
  return (
    <EditorChromeContext.Provider value={value}>
      {children}
    </EditorChromeContext.Provider>
  );
}

/**
 * The one slim editor header row: app icon (links home) plus a content area.
 * 42px, the approved prototype's `header` — a 26px icon tile in 8px/14px
 * padding.
 */
function EditorHeaderRow({
  children,
  contentRef,
  style,
}: {
  children?: ReactNode;
  contentRef?: ((el: HTMLElement | null) => void) | undefined;
  style?: CSSProperties | undefined;
}) {
  return (
    <header
      style={style}
      className="flex h-[2.625rem] min-w-0 shrink-0 items-center gap-3 border-b bg-background px-3.5">
      <EditorAppIcon />
      <div ref={contentRef} className="flex min-w-0 flex-1 items-center gap-3">
        {children}
      </div>
    </header>
  );
}

/**
 * Puts `children` in the app's single editor header row.
 *
 * Inside the app shell on an editor route this is a portal into the row
 * `SiteHeader` already rendered, so a page's identity and actions share one
 * row with the app icon and no page can stack a second header. React context
 * crosses portals, so the content still reads the editor's own providers.
 *
 * Outside that shell — an embed, or a test rendering `ChartEditor` on its
 * own — there is no row to fill, so this renders one itself and the header is
 * never simply missing.
 */
export function EditorHeaderContent({
  children,
  standaloneStyle,
}: {
  children: ReactNode;
  /** Style for the row rendered in the standalone (no app shell) case. */
  standaloneStyle?: CSSProperties | undefined;
}) {
  const chrome = useContext(EditorChromeContext);
  if (chrome?.hasEditorHeader) {
    return chrome.headerSlot ? createPortal(children, chrome.headerSlot) : null;
  }
  return <EditorHeaderRow style={standaloneStyle}>{children}</EditorHeaderRow>;
}

/**
 * Site-wide header. Editor routes get the compact row (always present, so
 * page-owned content lands in it rather than under it); every other route
 * gets the full site nav, unchanged.
 */
export default function SiteHeader({siteNav}: {siteNav: ReactNode}) {
  const chrome = useContext(EditorChromeContext);
  if (!chrome?.hasEditorHeader) {
    return <>{siteNav}</>;
  }
  return <EditorHeaderRow contentRef={chrome.setHeaderSlot} />;
}
