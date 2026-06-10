# Research

How a 3D scene decides what you clicked on. Give a renderer a camera, a ray, and a graph of meshes, and it has to define from scratch what "the user clicked that" even means — three independent decisions: which objects stop the ray (**occlusion**), what reaches the ones behind them (**propagation**), and how anything learns the ray hit nothing (**the miss**).

These documents map that space across the major 3D renderers, trace where solid-three has stood on each decision across its rewrites, and mark which are still open. The recurring subject is `onPointerMissed` — the one primitive solid-three inherited from react-three-fiber and keeps redesigning (issue #21, the `*Missed` split, the open `onVoid*` / `event.object` fork).

## The documents

Read them in this order — each leans on the vocabulary the one before it sets.

- **[Pointer events in 3D](./pointer-events-in-3d.md)** — the design space, framework-agnostic. "Pointer events" is not one decision but three independent ones — **occlusion** (which objects stop the ray), **propagation** (how a hit becomes handler calls), and **the miss** (how code learns a click didn't land) — placed across the DOM, react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte. Establishes the lexicon the other two reuse.
- **[solid-three's pointer-event system: past, now, future](./solid-three-event-system.md)** — the chronology. solid-three's behaviour has been flipped between defensible defaults by one rewrite after another, and nobody noticed each time, because the tests pin _which registry an object lands in_, not _what happens when you click_. Tracks six axes from the 2023 r3f port to today's `next`, and runs the two open PRs (#75, #76) against them — surfacing that they silently disagree on participation, an axis the fork isn't even framed around.
- **[Deselection in solid-three](./deselection-in-solid-three.md)** — a short companion to both. Deselection (click empty space to clear a selection) is the one need the whole `*Missed` family exists to serve; the two ways to build it decide whether per-object "not-me" is needed at all.

## Conventions

- Each document opens with a one-line blockquote pointing to its companions and stating what it assumes you've already read.
- Sources are cited inline and collected at the end (read dates, version numbers, the exact source files), so a claim can be re-checked against the code it came from.
- These are analyses, not decisions — the job is to make the space precise, not to pick. Where a decision is live, it's flagged as open.
