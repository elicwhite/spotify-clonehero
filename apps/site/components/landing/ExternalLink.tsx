import type {ReactNode} from 'react';

/**
 * A named third-party project, linked from the copy that mentions it.
 *
 * Landing pages name the other tools they measure against and link them
 * (`docs/landing-page-style-guide.md` §5.2: be generous, never characterize
 * another tool's authors). This is that link, so every page renders it the
 * same way.
 */
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      {children}
    </a>
  );
}
