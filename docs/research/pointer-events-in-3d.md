# Pointer events in 3D: occlusion, propagation, and the miss

> Working draft. An analysis of the problem space, using react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte as prior art — followed by a dedicated section on solid-three's own chronology. (Surprise from the Threlte read: it did not invent a new miss solution — it keeps r3f's per-object `onpointermissed`, just with no canvas-level variant and no VoidObject. Source: `@threlte/extras` `packages/extras/src/lib/interactivity/`, `main`, 2026-06-09.)

## The problem

A 2D UI toolkit gets pointer events almost for free: the browser hit-tests the DOM, picks a target, and bubbles the event up the tree. A 3D scene has none of that machinery. There's a camera, a ray, and a graph of meshes — and from that you have to define, from scratch, what "the user clicked on that" even means: which object a ray belongs to, what happens to the objects behind it, and what it means to click where there is nothing at all.

There's prior art. react-three-fiber, TresJS (through `@pmndrs/pointer-events`), and Threlte all ship pointer-event systems, and all reached for the same reference: the DOM. Reuse its vocabulary — `onClick`, bubbling, `stopPropagation`, `pointer-events: none` — so a web developer feels at home. That's a reasonable instinct and worth taking seriously. It's also worth holding at arm's length, because the goal is not DOM parity — it's a pointer-event system that is good _for 3D_. Those are different targets, and the places where they pull apart are exactly where these systems get confusing.

The core claim of this document: "pointer events" is not one decision but **three independent ones** — _occlusion_, _propagation_, and _the miss_ — and most of the confusion comes from treating them as a single bundle, or from assuming that because a system borrowed the DOM's _words_ it also borrowed the DOM's _behavior_. We define the three axes and place the DOM, r3f, TresJS / pmndrs, and Threlte on each. A final section then traces solid-three's own path through this space — including a regression it shipped without noticing — and asks where copying the DOM stops being a good idea.

## Three axes

### Occlusion — which objects stop the ray?

- _What it decides:_ given a ray, which objects are even candidates to be hit. Equivalently: what is "solid" vs "transparent" to the pointer.
- _Sub-question (per-type vs union):_ if an object handles one gesture (say `wheel`), is it solid to _other_ gestures (say `click`)?
- _Sub-question (override):_ can you override the per-object default — make a handler-less object solid, or a handler-bearing one transparent?
- _Reference points:_ DOM = all geometry is solid (opt out with `pointer-events: none`), handlers irrelevant. The 3D libs invert this default: only handler-bearing objects are solid; a handler-less mesh is implicitly `pointer-events: none`.

On the override sub-axis the libraries differ sharply, and again it tracks DOM-faithfulness. The DOM gives full per-element control (`pointer-events: auto | none`). Only `@pmndrs/pointer-events` replicates that per object — `pointerEvents: 'auto' | 'listener' | 'none'` (`'auto'` = solid without a handler, `'none'` = transparent with one, `'listener'` = the default). TresJS therefore _has_ it, but only as an incidental Object3D property pass-through (`nodeOps.patchProp` blindly assigns unknown props), not a typed/documented API. r3f offers opt-**out only** via three's `raycast` (`raycast={null}` drops the object). Threlte offers only a single global `filter(hits)` — no per-object flag. Of the three, only the pmndrs stack can opt a handler-_less_ object _into_ occlusion.

### Propagation — how a hit becomes handler calls

- _What it decides:_ once the ray hits something, whose handlers fire, in what order, and what `stopPropagation` stops.
- _Three shapes:_ (a) ancestor/tree bubbling (walk the hit object's parent chain — DOM); (b) z-depth tunnelling (fire each stacked intersection front-to-back — r3f); (c) closest-hit-only (just the nearest object, no depth walk — `@pmndrs/pointer-events`).
- _The trap:_ "it bubbles like the DOM" conflates (a) with (b). They are different axes of motion — up the tree vs back through depth.

### The miss — how a target learns a click didn't land on it

- _What it decides:_ the negative signal — code learning that a click did **not** land on a given target. This splits in two:
  - **the void** (the canvas-level special case): the click hit _nothing_ — empty space. This is the deselect use case.
  - **per-object "not-me":** the click hit _something else_. The object wasn't the target, even though the click wasn't a void.
- _Why this isn't "the void" as an axis:_ per-object `Mesh.onPointerMissed` fires when you click a _different_ object, which is not the void at all. "The void" names only the canvas-level half; "the miss" is the whole axis.
- _Shapes seen in the wild:_ a negative callback (`onPointerMissed`); per-object "missed" (complement of the hit set); a synthetic VoidObject the ray actually "hits" (the void reframed as a positive hit); reading `event.object` on a canvas-level handler; or nothing at all.
- _Key interaction:_ whether an unrelated handler suppresses the void is an _occlusion × miss_ interaction, not a property of the miss model alone.

## The landscape

First-pass placement:

| Axis                               | DOM                                        | react-three-fiber                             | TresJS / `@pmndrs/pointer-events`                                                         | Threlte                                                                |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Occlusion** of no-handler object | solid (still a target)                     | transparent (implicit `pointer-events: none`) | transparent by default (`pointerEvents: 'listener'`), per-object overridable              | transparent (explicit `interactiveObjects` list)                       |
| **Per-type vs union**              | n/a (all-or-nothing)                       | union (any handler → solid to all gestures)   | union (any listener → solid; `pointerEvents` is per-object, not per-type)                 | union (one handler → hit-target for all types)                         |
| **Override** (opt-in / opt-out)    | full: `pointer-events: auto \| none`       | opt-out only (`raycast={null}`)               | full: `pointerEvents: auto \| listener \| none` (pmndrs pass-through, not first-class)    | global `filter(hits)` only                                             |
| **Propagation**                    | ancestors only                             | z-depth tunnel + ancestor bubble              | **closest hit only** + ancestor bubble                                                    | z-depth tunnel + ancestor bubble                                       |
| **The miss**                       | none native (read `target === background`) | `onPointerMissed`: canvas **and** per-object  | VoidObject: a real hit on a giant synthetic sphere; missed = `click` on it (canvas-level) | per-object `onpointermissed` **only** — no canvas-level, no VoidObject |

Two clusters fall out of this table. **r3f and Threlte are nearly the same system** — union occlusion, z-depth-tunnel + ancestor-bubble propagation, per-object `onPointerMissed`. `@pmndrs/pointer-events` (and thus TresJS) is the real outlier: closest-hit-only propagation, the VoidObject, and the only true per-object override. So the "mainstream 3D" model is r3f's, and pmndrs represents the one genuine alternative — and it's also the most DOM-faithful (closest-hit ≈ DOM occlusion, VoidObject ≈ the always-a-target document, `pointerEvents` ≈ the CSS property).

Note too that **z-depth tunnelling is the majority, not the quirk** (r3f and Threlte both do it); closest-hit-only (pmndrs) is the minority choice. The confusion isn't that tunnelling is rare — it's that it's never named as distinct from tree-bubbling.

## Where the confusion comes from

_The specific conflations to name and defuse:_

- "It bubbles like the DOM" → assumed ancestor propagation, but r3f moves along z-depth too.
- "Missed = no handler ran" → actually "no _interactive object_ was hit"; an object with an unrelated handler counts as a hit.
- "No handler = harmless" → it's `pointer-events: none`; the object vanishes from hit-testing entirely (and so a click can fall through it to whatever's behind).
- "The void is the miss" → the void is only the canvas-level half; per-object "missed" fires on a real hit elsewhere.
- "Borrowed the words = borrowed the behavior" → the DOM vocabulary is reused even where the behavior diverges.

## The miss, in depth

The miss has **two levels**, and keeping them apart is most of the clarity here:

- **The void** — canvas-level. The click hit _nothing_; the pointer is over empty space. This is the deselect case.
- **Per-object "not-me"** — the click hit _something else_. A given object learns it wasn't the target, even though the click did land on a real object.

Systems vary on two things at once — which of those levels they expose, and how they _represent_ a miss — and the two turn out to be coupled.

| System                            | The void (canvas) | Per-object | Representation                                                         |
| --------------------------------- | ----------------- | ---------- | ---------------------------------------------------------------------- |
| r3f                               | yes               | yes        | negative callback (`onPointerMissed`) at both levels                   |
| TresJS / `@pmndrs/pointer-events` | yes               | —          | VoidObject — the void as a _positive_ hit on a synthetic global sphere |
| Threlte                           | —                 | yes        | per-object negative callback (`onpointermissed`)                       |

**The level is forced by the representation — and r3f is the only one that paid for both.** A VoidObject is a single global object, so it can only ever report "the _scene_ was missed" — canvas-level only. (Verified in `@tresjs/core` 5.8.1: `pointerMissed` is absent from the `supportedPointerEvents` allow-list, and `nodeOps.patchProp` only wires events in that list, so a per-object `@pointermissed` is silently dropped.) A complement set — "fire on every interactive object the ray didn't hit" — is per-object by construction, with a canvas total-miss available only as a bolt-on; Threlte keeps the per-object half and drops the bolt-on. So the two r3f descendants each inherited the _opposite_ half.

**One caveat cuts across every representation.** In any union-occlusion system, an unrelated handler (`onWheel`) still suppresses the void, because the object counts as a hit. No miss _representation_ fixes this — only the _occlusion_ choice (per-type) does. The miss axis and the occlusion axis are not independent here.

## solid-three over time: pre-#66 vs post-#66 vs now

solid-three has oscillated between the two poles the prior art stakes out — r3f's and pmndrs's — and one of those moves was unintended. Pre- and post-`#66` are not "the same system improving"; they are different designs with _different_ problems.

|                             | Occlusion / registry | The miss                                   | Issues of this era                                                                                                                          |
| --------------------------- | -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **pre-`#66`** (deliberate)  | per-type registries  | `*Missed` (per-object + canvas total-miss) | the `*Missed` machinery: a bespoke 3-phase complement algorithm off the main dispatch path, a tripled handler API, "negative event" framing |
| **post-`#66`** (unintended) | union registry       | `*Missed` (unchanged)                      | inherited r3f's union asymmetry — an unrelated handler (`onWheel`) now suppresses the click-miss — without anyone choosing it               |
| **now**                     | union registry       | void via canvas `event.object`             | see open questions below                                                                                                                    |

- **pre-`#66` was a deliberate design.** Per-type registries meant an `onWheel`-only object was _not_ in the click raycast, so clicking it did _not_ suppress the click-miss — the union asymmetry simply didn't exist. The chosen costs were in the `*Missed` implementation, not the occlusion model: a special-cased 3-phase complement pass and three extra handlers.
- **`#66` (the source-agnostic pointer system) changed semantics without intent.** Collapsing the per-type registries into one union registry was in service of source-agnosticism; the occlusion flip from per-type to union was collateral. No test caught it, because the suite pinned registry _routing_, not observable behavior.
- **So the eras fail differently.** Pre-`#66`'s problems were the price of the `*Missed` machinery. Post-`#66` kept that machinery _and_ added the union asymmetry on top — a behavior nobody chose. The lesson for the exhaustive test pass: assert behavior, not structure.
- **On the miss axis, solid-three walked the r3f → tres path.** The pre-`#66` `*Missed` was r3f-shaped — both levels, via the 3-phase complement pass. The current `event.object` model is tres-shaped — the void only, as a positive canvas-level hit. It moved from one pole to the other.

## Open questions

- _Occlusion._ Lean is to restore the pre-`#66` per-type intent. Open sub-question: should a front object that doesn't handle the gesture **block** (no fall-through, and count as a void) or be **transparent** (fall-through to whatever's behind)? The DOM analogy argues for block-and-count-as-miss.
- _Propagation._ Keep r3f-style z-depth tunnelling, or move to closest-hit-only like `@pmndrs/pointer-events`?
- _Override._ Stay opt-out-only (`raycastable`), or add a real per-object `pointerEvents`-style control (the one place pmndrs is clearly ahead)?
- _Miss model._ Settle on the canvas `event.object` model vs `onVoid*` vs restoring per-object missed — and decide explicitly whether per-object "not-me" is worth supporting at all, or whether only the void matters.
