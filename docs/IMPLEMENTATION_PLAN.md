# Long Box Implementation Plan

This document records phase gates and the product-design context that implementation must preserve. The detailed task brief remains the source for feature scope; this file captures decisions that should survive between coding sessions.

## Current status

| Phase | Status | Exit gate |
| --- | --- | --- |
| 1. Foundation and ingestion | In progress | Apply the migration to the configured Supabase project, run live ingestion twice, and verify all five validation queries. |
| 2. Reading-path engine | Not started | Deterministic grouping, ranking, explanations, API tests, and measured queries. |
| 3. Product UI | Not started | Search and reading-path flows pass automated and real-browser validation. |
| 4. Production hardening | Not started | Performance, reliability, security, CI, documentation, and smoke checks pass. |
| 5. Optional intent parser | Deferred | Grounded structured intent improves usability without generating comic facts. |

Later phases do not begin until the current phase exit gate passes.

# Phase 3 design context

## Product promise

Long Box answers: **“I want to read this character, team, storyline, or combination, but where do I start?”**

The experience must reduce decades of continuity into a calm progression:

> **START HERE → CHOOSE YOUR DIRECTION → GO DEEPER**

The signature interaction is a small, guided branching reading path—not a ranked database dump and not a giant network graph.

## Visual north star

**70% premium editorial / 30% modern independent comic shop.**

A useful shorthand is: *The Criterion Collection for comics meets a thoughtful independent comic shop.* The product should feel sophisticated, knowledgeable, inviting, curious, premium, slightly playful, and calm.

The primary personality comes from typography, composition, comic covers, and the reading-path interaction. Comic-themed decoration stays restrained.

### Explicit anti-patterns

Do not use:

- generic SaaS dashboards, sidebars, or dense card grids;
- speech bubbles, POW/BAM graphics, or superhero clichés;
- Netflix-style cover carousels;
- neon/cyberpunk color, heavy gradients, or pervasive glassmorphism;
- excessive rounded cards, halftones, distress, or literal comic panels;
- raw ComicVine database layouts;
- a generic chatbot as the main interaction.

## Provisional visual tokens

These values come from the written brief and remain **provisional until the Figma source is inspected**. Phase 3 must replace or confirm them in an authoritative `DESIGN.md` before components are built.

| Role | Provisional value | Intent |
| --- | --- | --- |
| Canvas | `#151412` | Warm ink-black, never pure black or blue-gray. |
| Elevated surface | `#201F1C` | Menus, disclosures, and restrained content surfaces. |
| Primary text | `#F1EEE7` | Warm paper white. |
| Secondary text | `#AAA69D` | Metadata and supporting copy; verify contrast. |
| Border | `#3A3832` | Low-contrast warm divider. |
| Brand blue | `#2864B7` | Print-inspired royal blue for selected states, links, path nodes, and primary actions. |
| Error | `#C95C54` | Calm, legible destructive/error state. |

Color outside this restrained system should come mainly from comic-cover artwork. Every final foreground/background pairing must meet WCAG AA.

## Typography

Use a strong editorial serif/display face for character names, story titles, hero statements, and major path labels. Pair it with a neutral, highly legible sans-serif for navigation, controls, metadata, descriptions, and issue numbers.

Implementation rules:

- large display type is a brand element, not decoration;
- body copy stays readable and relatively neutral;
- uppercase sans-serif micro-labels such as `START HERE`, `MODERN`, and `7 ISSUES` are sparse and carefully tracked;
- final font families and exact scale come from the Figma inspection and are recorded in `DESIGN.md`;
- no default “Inter everywhere” implementation.

## Layout and material

- Use a disciplined responsive grid beneath editorial, occasionally asymmetric composition.
- Preserve generous margins, section spacing, and negative space.
- Show fewer, larger recommendations instead of many equal cards.
- Treat covers as editorial artwork or physical objects with restrained shadow and occasional overlap.
- Keep physical-comic influence near **10%**: subtle grain, isolated print details, or registration marks only.
- Do not place every cover inside the same rounded container.

## Signature reading-path interaction

### Desktop

1. Present one prominent **START HERE** recommendation.
2. Give one concise, factual reason it is accessible.
3. Reveal a deliberately limited set of meaningful branches such as `MODERN`, `THE CLASSICS`, `SHORT & ESSENTIAL`, `ORIGIN`, or `WEIRD STUFF`.
4. Use thin connecting lines, nodes, editorial labels, and covers to communicate direction.
5. Expand a selected node progressively rather than showing all metadata at once.

The visualization is a guided tree with a small visible breadth. It is never an unconstrained graph.

### Mobile

Do not shrink the desktop tree. Use a vertical sequence:

1. `START HERE`
2. the starting recommendation;
3. `WHERE NEXT?`;
4. large branch choices;
5. reveal one chosen branch vertically.

Touch targets are at least 44×44 px, and the path remains understandable without hover.

## Progressive disclosure

Show initially:

- title and cover;
- issue or issue range;
- approximate length;
- year/era;
- one short descriptor or reason.

Reveal on request:

- detailed deterministic reasons;
- creators and publication metadata;
- individual issues;
- character and story-arc relationships;
- ranking details appropriate for users.

The engine’s reasoning should be visible but described as facts, not vague “AI recommendations.”

## Required product surfaces

Phase 3 includes:

1. desktop and mobile homepage;
2. autocomplete with multi-entity selection;
3. single-character reading page using Daredevil;
4. multi-character reading page using Spider-Man + Daredevil;
5. expanded reading-path branch;
6. recommendation detail and issue disclosure;
7. intentional no-shared-stories state;
8. loading, skeleton, API error, missing-image, and partial-metadata states;
9. a specific mobile reading-path interaction.

The component vocabulary must cover navigation, hero search, autocomplete, entity tokens, cover treatment, featured recommendation, path node/branch, issue list, labels, buttons, popovers, and all system states without turning the product into a component showroom.

## Motion and accessibility

Motion reinforces exploration only:

- path lines may draw as branches appear;
- nodes may reveal progressively;
- selected covers may move slightly forward;
- disclosure expands smoothly;
- reduced-motion mode removes path drawing and transform-based movement while preserving state changes.

Required accessibility:

- semantic forms and controls;
- keyboard-complete autocomplete and path navigation;
- visible focus treatment using the brand blue or a verified accessible derivative;
- meaningful cover alt text;
- WCAG AA contrast;
- readable line lengths and type sizes;
- no information available only through color, motion, or hover.

## Figma handoff checklist

A Figma inspection must capture and reconcile:

- file/page/frame names and the most recent Long Box screens;
- exact colors and contrast pairings;
- font families, weights, line heights, and tracking;
- grid, content widths, spacing scale, and breakpoints;
- radii, borders, shadows, cover aspect ratios, and image treatment;
- component variants and interaction states;
- desktop/mobile reading-path behavior;
- loading, empty, error, and reduced-motion intent;
- reusable assets that may legally ship in the repository.

After inspection, write `DESIGN.md` as the single exact implementation specification and note any difference between the Figma source and this brief.

## Phase 3 design acceptance criteria

The UI phase is not complete until:

- the main search and multi-character flows work with keyboard and pointer input;
- the top recommendation reads as an editorial feature, not “card one”;
- deterministic reasons are visible and understandable;
- desktop branching and mobile vertical branching both work;
- loading, error, empty, missing-cover, and partial-data states are intentional;
- desktop, tablet, and mobile browser checks pass without overflow or console errors;
- the implementation matches the approved Figma-derived `DESIGN.md` rather than ad hoc agent defaults.
