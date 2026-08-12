# Page shells and the outer gutter

## The gutter contract

`components/SiteChrome.tsx` owns two decisions for every route:

- **which header** it renders — the compact site header, or the full site nav
- **how much gutter** `<main>` gives it

These are independent. Deriving the second from the first is what left
`/find-music` — a dashboard that wants the regular nav _and_ no gutter — with
no way to say so, so it cancelled the gutter back out with a hard-coded
`-m-4 w-[calc(100%+2rem)]` that would have broken silently the day the gutter
changed.

Both live as fields of one `ROUTE_CHROME` entry, matched by prefix, first match
wins:

```ts
{prefix: '/chart-editor', header: 'compact', gutter: 'px-3 pb-3'},
{prefix: '/find-music',   header: 'nav',     gutter: ''},
```

| Field    | Values                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- |
| `header` | `'compact'` for editor routes, `'nav'` for everything else.                                       |
| `gutter` | `'px-3 pb-3'` on editor routes, `''` for full-bleed pages, `'p-4'` by default (`DEFAULT_CHROME`). |

One entry per route rather than one list per decision, so a route cannot appear
in two lists and have one silently win.

**If your page wants a different gutter, give it a `ROUTE_CHROME` entry.** Do
not subtract the gutter back out in the page. A test fails on
`w-[calc(100%+…)]` and on an all-sides negative margin — including responsive
forms like `sm:-m-4` — anywhere in `app/`, `components/`, or `lib/`.

A page-specific affordance is not a gutter workaround and is fine to keep:
`/find-music` carries `pt-12 sm:pt-0` to clear a floating control on small
screens.

## Density

`app/globals.css` defines `--ed-*` tokens under `:root[data-density='compact']`,
switched on by `useEditorDensity` for as long as a chart editor is mounted.

The scope is the **document root**, not the editor's subtree, because Radix
renders Select menus, Dialogs, and AlertDialogs into `document.body`. Anything
scoped below the root leaves every portalled surface at full size.

Consumers spend `var(--ed-token, <default>)`, where the default is the unscoped
appearance — so the override is additive and needs no `!important`, and a page
that never mounts an editor renders exactly as it would without the scope.

One Tailwind gotcha: ambiguous utilities need a type hint when the value is a
bare `var()`. `text-[var(--ed-text-label)]` compiles to `color`, not a font
size. Spend `text-[length:var(--ed-text-label,…)]`.

## Dashboard layouts

There is **no single dashboard shell**, and that is a recorded position rather
than an oversight. `../docs/design-system-audit.md` Track C has the full
comparison.

| Page                  | Shell                                                                                                       | Status                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `/chart-editor`       | `.chart-editor-grid`, a named-areas grid over header / sidebar / main / bottom with a ≥1440px rearrangement | The reference structure.                                                   |
| `/find-music`         | Its own header row plus a two-column grid; a strict subset of the editor's regions                          | Full-bleed, no gutter hack.                                                |
| `/sheet-music`        | Document-flow search page                                                                                   | **Different, keep.** Lower density and document scrolling are intentional. |
| `/sheet-music/[slug]` | Full-viewport chart detail view                                                                             | **Different, keep.** Not a dashboard: no rail, no region structure.        |

If a shared shell is built later, the design question is already settled in
writing: it must be the named-areas grid generalized, because a flex shell
cannot express the editor's ≥1440px rearrangement.

Two conditions should hold first:

1. **A second genuine consumer beyond `/find-music`.** With `/sheet-music` and
   `[slug]` recorded as real variants, a shell wrapping only `/find-music`
   while the editor keeps `.chart-editor-grid` would leave two shells where
   there is one grid today — strictly worse.
2. **A screenshot baseline of the chart editor with a chart loaded.** The
   ≥1440px rearrangement only exists once a chart is open, and the Phase 0
   baseline could only capture the picker state, so the riskiest migration has
   no reference to diff against.
