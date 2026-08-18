# Long Box Visual System

## Brand

- Voice: knowledgeable, calm, inviting
- Design read: 70% premium editorial, 30% modern independent comic shop
- Dials: variance 6, motion 4, density 3
- Signature: one clear starting point followed by a small guided branching path
- Anti-patterns: SaaS dashboards, speech bubbles, superhero clichés, Netflix carousels, glassmorphism, neon, excessive rounding, dense metadata dumps

## Color system

Dark mode is the product theme.

| Token | Value | Usage |
| --- | --- | --- |
| Background | `#121213` | Page canvas |
| Foreground | `#F1EEE7` | Primary copy |
| Card | `#181819` | Search, recommendation, and disclosure surfaces |
| Card foreground | `#F1EEE7` | Text on cards |
| Muted | `#1F1F20` | Hover and skeleton surfaces |
| Muted foreground | `#AAA69D` | Metadata and supporting copy |
| Border | `#272727` | Dividers and controls |
| Primary | `#205DE3` | Primary actions, active nodes, links, focus |
| On primary | `#FFFFFF` | Text on primary |
| Secondary | `#D7D2C8` | Quiet high-emphasis labels |
| On secondary | `#121213` | Text on secondary |
| Destructive | `#C95C54` | Error border and text |
| On destructive | `#FFFFFF` | Text on destructive |
| Ring | `#74A0FF` | Focus-visible outline |

Comic covers supply all other visible color. Do not introduce one-off decorative colors.

## Typography

Fonts ship through `next/font`.

- Display: Bodoni Moda, 500, optical editorial contrast
- Body and controls: Geist, 400/500/600
- Display: clamp(`3.25rem`, `7vw`, `7rem`), line-height `0.95`, tracking `-0.045em`
- H1: clamp(`2.75rem`, `5vw`, `5rem`), line-height `1`, tracking `-0.04em`
- H2: clamp(`2rem`, `3.5vw`, `3.5rem`), line-height `1.05`, tracking `-0.03em`
- H3: `1.375rem`, line-height `1.2`
- Body: `1rem`, line-height `1.6`, max `65ch`
- Small: `0.875rem`, line-height `1.45`
- Micro-label: `0.75rem`, 600, uppercase, tracking `0.12em`

Use no text smaller than `0.75rem`. Use micro-labels no more than once per three sections.

## Spacing

- Base unit: `4px`
- Scale: `4, 8, 12, 16, 24, 32, 48, 64, 96, 128`
- Header height: `64px`
- Section block spacing: `96px` desktop, `64px` mobile
- Content max width: `1280px`
- Page gutters: `48px` desktop, `24px` tablet, `20px` mobile
- Component gaps: `12px` compact, `24px` standard, `48px` editorial

## Grid

- Desktop: 12 columns, `24px` gutters
- Tablet: 8 columns, `20px` gutters
- Mobile: 4 columns, `16px` gutters
- Breakpoints: `640px`, `768px`, `1024px`, `1280px`
- Editorial layouts may be asymmetric but must align to this grid.

## Shape and border

- Cards and covers: `2px` radius
- Inputs and buttons: `2px` radius
- Tags: `999px` only for selected entity tokens
- Borders: `1px solid #272727`
- No mixed soft-card radius system.

## Elevation

- Level 0: no shadow for page and grouped content
- Level 1: `0 16px 48px rgba(0, 0, 0, 0.28)` for physical covers
- Level 2: `0 24px 64px rgba(0, 0, 0, 0.36)` for autocomplete/popovers
- Surfaces remain flat; elevation belongs primarily to cover objects and overlays.

## Motion

- Hover: `160ms ease-out`, transform/opacity only
- Disclosure: `240ms cubic-bezier(.645,.045,.355,1)`
- Path reveal: `300ms cubic-bezier(.23,1,.32,1)`
- Button press: `100ms ease-out`, scale `0.98`
- Cover hover: translateY `-4px`, never rotate more than `0.5deg`
- Reduced motion: remove transforms and line-drawing; state changes remain immediate and visible
- No ambient loops, parallax, bounce, or scroll hijacking

## Components

- Navigation: single 64px line; wordmark left, two links right; mobile keeps wordmark and one Discover action
- Hero: centered editorial statement is allowed because search is the singular product action; fits initial viewport
- Search: visible label, full-width 52px control, adjacent primary action; autocomplete uses a flat bordered surface
- Entity token: compact pill, clear remove button with 44px target
- Cover: 2:3 ratio, object-fit cover, quiet paper placeholder when missing
- Featured recommendation: asymmetric cover/text composition, no generic card grid treatment
- Path: thin border lines and restrained nodes; maximum three visible branch groups
- Detail: native `details`/`summary` where possible for keyboard-safe progressive disclosure
- Empty/error: editorial message plus one recovery action; never a generic alert box
- Loading: layout-matched charcoal skeletons; no spinner

## Responsive reading path

- Desktop: horizontal branch rows from a prominent starting recommendation
- Mobile: vertical `START HERE`, then `WHERE NEXT?`, then one expandable branch at a time
- Do not scale down the desktop graph.

## Cover treatment

- Use real ComicVine cover artwork when available.
- Preserve the source aspect ratio inside a 2:3 frame with `object-fit: cover`.
- Missing art uses `#F1EEE7` with ink text, not a broken-image icon.
- Covers may overlap only for multi-issue runs and by at most `16px`.
- Alt text format: `[Volume] issue [number] cover`.

## Accessibility

- WCAG AA minimum: 4.5:1 body, 3:1 large text
- Focus ring: `2px solid #74A0FF`, offset `3px`
- Touch targets: minimum `44px`
- Semantic headings, forms, lists, buttons, and native disclosure controls
- Autocomplete uses combobox/listbox semantics and keyboard navigation
- No meaning available only through color, cover art, motion, or hover
- All animations honor `prefers-reduced-motion`
