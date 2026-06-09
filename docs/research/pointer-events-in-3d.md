# Pointer events in 3D: occlusion, propagation, and the void

> Working draft. An analysis of the problem space, using react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte as prior art. (Surprise from the Threlte read: it did *not* invent a new void solution — it keeps r3f's per-object `onpointermissed`, just with no canvas-level variant and no VoidObject. Source: `@threlte/extras` `packages/extras/src/lib/interactivity/`, `main`, 2026-06-09.)

## The problem

A 2D UI toolkit gets pointer events almost for free: the browser hit-tests the DOM, picks a target, and bubbles the event up the tree. A 3D scene has none of that machinery. There's a camera, a ray, and a graph of meshes — and from that you have to define, from scratch, what "the user clicked on that" even means: which object a ray belongs to, what happens to the objects behind it, and what it means to click where there is nothing at all.

There's prior art. react-three-fiber and TresJS (the latter through `@pmndrs/pointer-events`) both ship pointer-event systems, and both made the same headline decision: emulate the DOM. Reuse its vocabulary — `onClick`, bubbling, `stopPropagation`, `pointer-events: none` — so a web developer feels at home. That's a reasonable instinct and worth taking seriously. It's also worth holding at arm's length, because the goal is not DOM parity — it's a pointer-event system that is good *for 3D*. Those are different targets, and the places where they pull apart are exactly where these systems get confusing.

The core claim of this document: "pointer events" is not one decision but **three independent ones** — *occlusion*, *propagation*, and *the void* — and most of the confusion (including a regression solid-three shipped without noticing) comes from treating them as a single bundle, or from assuming that because a system borrowed the DOM's *words* it also borrowed the DOM's *behavior*. We define the three axes, place the DOM and both prior arts on each, and only then ask where solid-three should sit — and where copying the DOM stops being a good idea.

## Three axes

### Occlusion — which objects stop the ray?

- *What it decides:* given a ray, which objects are even candidates to be hit. Equivalently: what is "solid" vs "transparent" to the pointer.
- *Sub-question (per-type vs union):* if an object handles one gesture (say `wheel`), is it solid to *other* gestures (say `click`)?
- *Reference points:* DOM = all geometry is solid (opt out with `pointer-events: none`), handlers irrelevant. The 3D libs invert this default: only handler-bearing objects are solid; a handler-less mesh is implicitly `pointer-events: none`.

### Propagation — how a hit becomes handler calls

- *What it decides:* once the ray hits something, whose handlers fire, in what order, and what `stopPropagation` stops.
- *Three shapes:* (a) ancestor/tree bubbling (walk the hit object's parent chain — DOM); (b) z-depth tunnelling (fire each stacked intersection front-to-back — r3f); (c) closest-hit-only (just the nearest object, no depth walk — `@pmndrs/pointer-events`).
- *The trap:* "it bubbles like the DOM" conflates (a) with (b). They are different axes of motion — up the tree vs back through depth.

### The void — what "clicking nothing" means

- *What it decides:* the signal a consumer gets when a press lands on empty space (the deselect use case).
- *Shapes seen in the wild:* a negative callback (`onPointerMissed`); per-object "missed" (complement of the hit set); a synthetic VoidObject that the ray actually "hits"; reading `event.object` / target on a canvas-level handler; or nothing at all.
- *Key interaction:* whether an unrelated handler suppresses the void is an *occlusion × void* interaction, not a property of the void model alone.

## The landscape

First-pass placement:

| Axis | DOM | react-three-fiber | TresJS / `@pmndrs/pointer-events` | Threlte | solid-three (current) |
|---|---|---|---|---|---|
| **Occlusion** of no-handler object | solid (still a target) | transparent (implicit `pointer-events: none`) | transparent by default (`pointerEvents: 'listener'`), per-object overridable | transparent (explicit `interactiveObjects` list) | transparent (union registry) |
| **Per-type vs union** | n/a (all-or-nothing) | union (any handler → solid to all gestures) | union (any listener → solid; `pointerEvents` is per-object, not per-type) | union (one handler → hit-target for all types) | union now; **was per-type before `#66`** |
| **Propagation** | ancestors only | z-depth tunnel + ancestor bubble | **closest hit only** + ancestor bubble | z-depth tunnel + ancestor bubble | z-depth tunnel + ancestor bubble |
| **The void** | none native (read `target === background`) | `onPointerMissed`: canvas **and** per-object | VoidObject: a real hit on a giant synthetic sphere; missed = `click` on it (canvas-level) | per-object `onpointermissed` **only** — no canvas-level, no VoidObject | was `*Missed` (3-phase complement); now void via canvas `event.object` |

Two clusters fall out of this table. **r3f and Threlte are nearly the same system** — union occlusion, z-depth-tunnel + ancestor-bubble propagation, per-object `onPointerMissed`. `@pmndrs/pointer-events` (and thus TresJS) is the real outlier: closest-hit-only propagation and the VoidObject. So the "mainstream 3D" model is r3f's, and pmndrs represents the one genuine alternative — and it's also the most DOM-faithful (closest-hit ≈ DOM occlusion, VoidObject ≈ the always-a-target document). solid-three has been oscillating between these two poles without naming them.

Note too that **z-depth tunnelling is the majority, not the quirk** (r3f, Threlte, solid-three all do it); closest-hit-only (pmndrs) is the minority choice. The confusion isn't that tunnelling is rare — it's that it's never named as distinct from tree-bubbling.

## Where the confusion comes from

*The specific conflations to name and defuse:*

- "It bubbles like the DOM" → assumed ancestor propagation, but r3f (and solid-three) move along z-depth too.
- "Missed = no handler ran" → actually "no *interactive object* was hit"; an object with an unrelated handler counts as a hit.
- "No handler = harmless" → it's `pointer-events: none`; the object vanishes from hit-testing entirely (and so a click can fall through it to whatever's behind).
- "Borrowed the words = borrowed the behavior" → the DOM vocabulary is reused even where the behavior diverges.

## The void, in depth

*Situate the four void models as points on axis 3, and show the occlusion × void interaction:*

- `onPointerMissed` (r3f): canvas-level on a totally empty click; per-object as the complement of the hit chain.
- per-object `onpointermissed` (Threlte): the same complement model as r3f, but **per-object only** — no canvas-level event and no VoidObject. Deselect means putting `onpointermissed` on the selectable object itself (it fires exactly when that object wasn't the one clicked).
- per-object `*Missed` (solid-three's first pass): a precise complement set, occlusion-correct via a re-raycast phase — but a bespoke 3-phase algorithm off the main dispatch path.
- VoidObject (`@pmndrs/pointer-events` / TresJS): reframes the negative event as a positive hit on a synthetic object; "missed" becomes ordinary propagation.
- `event.object` (solid-three, current): the canvas is the void; empty space = a canvas-level event whose `object` is undefined.
- *Sub-axis worth separating: canvas-level vs per-object.* "Did the whole scene get missed?" (canvas-level — r3f, tres, solid-three) is a different question from "was this particular object not the one hit?" (per-object — r3f, Threlte, solid-three's first pass). The deselect use case wants the first; r3f conflates both under one name.
- The shared wart: in every union-occlusion system, an unrelated handler (`onWheel`) still suppresses the void, because the object is a hit. The void *representation* doesn't fix that; the *occlusion* choice does.

## solid-three's position and open questions

*To be filled once the axes are agreed. Anchors:*

- The `#66` cautionary tale: the source-agnostic refactor collapsed per-type registries into one union registry and silently flipped the occlusion behavior from per-type to union — and no test caught it, because the suite pinned registry *routing*, not observable semantics. Lesson for the exhaustive test pass: assert behavior, not structure.
- Open fork 1 — occlusion: per-type vs union, and if per-type, whether a front object that doesn't handle the gesture should *block* (no fall-through, counts as a void) or be *transparent* (fall-through to whatever's behind).
- Open fork 2 — propagation: keep r3f-style z-depth tunnelling, or move to closest-hit-only like `@pmndrs/pointer-events`?
- Open fork 3 — void model: settle on the `event.object` canvas model vs `onVoid*` vs something else.
