'use client';

import {useEffect} from 'react';

/**
 * Marks the document root `data-density="compact"` for as long as at least
 * one chart editor is mounted, turning on the editor density scale defined
 * in `app/globals.css` (plan 0074 Phase 7 task 7c).
 *
 * The attribute goes on the root rather than the editor's own wrapper for
 * one reason: Radix renders Select menus, Dialogs and AlertDialogs into
 * `document.body`, outside the editor subtree. Anything scoped below the
 * root leaves every portalled surface at full size.
 *
 * The counter makes the scope safe when two editors overlap — a remount, or
 * a page that briefly renders two — where a plain set/unset pair would drop
 * the attribute while an editor was still on screen.
 */
let mountedEditors = 0;

export function useEditorDensity(): void {
  useEffect(() => {
    mountedEditors += 1;
    document.documentElement.dataset['density'] = 'compact';
    return () => {
      mountedEditors -= 1;
      if (mountedEditors === 0) {
        delete document.documentElement.dataset['density'];
      }
    };
  }, []);
}
