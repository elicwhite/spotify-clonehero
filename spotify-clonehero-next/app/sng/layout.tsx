'use client';

import {SngProvider} from './SngContext';

// A shared layout keeps the working package state alive across the /sng (landing)
// and /sng/manage (editor) routes, so navigating between them — including the
// browser Back button — is real client navigation rather than internal state.
export default function SngLayout({children}: {children: React.ReactNode}) {
  return <SngProvider>{children}</SngProvider>;
}
