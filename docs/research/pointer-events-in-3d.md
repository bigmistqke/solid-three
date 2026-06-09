# Pointer events in 3D: occlusion, propagation, and the miss

> Working draft. An analysis of the problem space, using react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte as prior art — then a dedicated section on solid-three's own chronology. Versions and the source files read are listed under **Sources** at the end (all 2026-06-09).

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

A second subtlety hides in "only handler-bearing objects are solid": it really means "only handler-bearing objects _and their descendants_." All three raycast each interactive object _recursively_ over its subtree — r3f `raycaster.intersectObject(obj, true)`, Threlte `intersectObjects(interactiveObjects, true)`, pmndrs propagates a `parentHasListener` flag down the tree — so a handler-less _child_ of a handler-bearing parent is swept into the hit-test and bubbles up to that parent. That's DOM-style event delegation, and it's the real exception to "handler-less = transparent": the rule holds only for an object that is _not_ a descendant of a handler-bearing one. A handler-less sibling in front of an interactive mesh is transparent; a handler-less child inside one is solid.

### Propagation — how a hit becomes handler calls

- _What it decides:_ once the ray hits something, whose handlers fire, in what order, and what `stopPropagation` stops.
- _Three shapes:_ (a) ancestor/tree bubbling (walk the hit object's parent chain — DOM); (b) z-depth tunnelling (fire each stacked intersection front-to-back — r3f); (c) closest-hit-only (just the nearest object, no depth walk — `@pmndrs/pointer-events`).
- _The trap:_ "it bubbles like the DOM" conflates (a) with (b). They are different axes of motion — up the tree vs back through depth.

What `stopPropagation` actually stops depends on the shape. In the depth-tunnel systems (r3f, Threlte) it halts _all_ farther entries — the objects stacked behind _and_ any not-yet-fired ancestors. In closest-hit (pmndrs) there is nothing deeper to stop, so it only cuts the ancestor bubble short. Threlte adds a second lever, `stopImmediatePropagation()`, that reaches the _native_ DOM event (to silence sibling DOM listeners like OrbitControls) — a different thing from halting in-scene propagation.

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
| **Subtree delegation**             | yes (geometry + ancestry)                  | yes (recursive raycast)                       | yes (`parentHasListener`)                                                                 | yes (recursive raycast)                                                |
| **Propagation**                    | ancestors only                             | z-depth tunnel + ancestor bubble              | **closest hit only** + ancestor bubble                                                    | z-depth tunnel + ancestor bubble                                       |
| **The miss**                       | none native (read `target === background`) | `onPointerMissed`: canvas **and** per-object  | VoidObject: a real hit on a giant synthetic sphere; missed = `click` on it (canvas-level) | per-object `onpointermissed` **only** — no canvas-level, no VoidObject |

Two clusters fall out of this table. **r3f and Threlte are nearly the same system** — union occlusion, z-depth-tunnel + ancestor-bubble propagation, per-object `onPointerMissed`. `@pmndrs/pointer-events` (and thus TresJS) is the real outlier: closest-hit-only propagation, the VoidObject, and the only true per-object override. So the "mainstream 3D" model is r3f's, and pmndrs represents the one genuine alternative — and it's also the most DOM-faithful (closest-hit ≈ DOM occlusion, VoidObject ≈ the always-a-target document, `pointerEvents` ≈ the CSS property).

Note too that **z-depth tunnelling is the majority, not the quirk** (r3f and Threlte both do it); closest-hit-only (pmndrs) is the minority choice. The confusion isn't that tunnelling is rare — it's that it's never named as distinct from tree-bubbling.

## Where the confusion comes from

_The specific conflations to name and defuse:_

- "It bubbles like the DOM" → assumed ancestor propagation, but r3f moves along z-depth too.
- "Missed = no handler ran" → actually "no _interactive object_ was hit"; an object with an unrelated handler counts as a hit.
- "No handler = harmless" → it's `pointer-events: none`; the object vanishes from hit-testing entirely (and so a click can fall through it to whatever's behind).
- "Handler-less = always transparent" → true only for non-descendants; a handler-less _child_ of an interactive parent is swept in by the recursive raycast and delegates up to it.
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

### How the canvas-level miss is delivered

Even among the systems that _have_ a canvas-level miss, the canvas-level 3D handler each one provides is **singular and dedicated** — at most one of them, wired only to the miss, never a general-purpose canvas handler:

- **r3f:** one dedicated callback, `onPointerMissed`. A plain `<Canvas onClick>` is _not_ a 3D handler — it's a DOM listener spread onto the element.
- **TresJS:** one dedicated handler, `@pointermissed` (the VoidObject's `click`). `<TresCanvas>` _forwards_ the whole pointer set (`@click`, `@pointerdown`, …), but the source itself notes they "bubble up" — they are native DOM events, not raycast events; only `@pointermissed` carries `event.object`.
- **Threlte:** none. There is no canvas/scene-level handler at all; even "missed" is dispatched per-object.

So across the prior art the canvas tops out at a _single dedicated_ miss callback (r3f, TresJS) or nothing (Threlte), and general canvas pointer props are plain DOM. solid-three (below) is the one system that breaks this.

**One caveat cuts across every representation.** In any union-occlusion system, an unrelated handler (`onWheel`) still suppresses the void, because the object counts as a hit. No miss _representation_ fixes this — only the _occlusion_ choice (per-type) does. The miss axis and the occlusion axis are not independent here.

## Worked scenarios

Four concrete scenes, across the DOM and the prior art (solid-three's behaviour lives in its own section).

**1. Click empty space — the void.**

```jsx
<Box onClick={select} /> // one interactive mesh in the scene
// the click lands on empty space — no mesh under the ray
```

- DOM: the target is the background element; there is no "miss" event, so you detect it as `event.target === container`.
- r3f: the canvas `onPointerMissed` fires.
- TresJS: the ray "hits" the global VoidObject and `@pointermissed` fires.
- Threlte: every registered object that wasn't hit receives its own `onpointermissed`; there is no single canvas signal.

**2. Click an object whose only handler is `onWheel`.**

```jsx
<Text onWheel={scroll} /> // its only handler is onWheel — no onClick
// the click lands on the Text
```

- DOM: no analogue — there's no per-event-type interactivity.
- r3f / TresJS / Threlte (all union): the object is interactive for _every_ gesture, so the click "hits" it. It has no `onClick`, so nothing runs — but the click is consumed: the canvas miss is suppressed (r3f, TresJS), and the object counts as hit everywhere. An unrelated handler silently eats the click.

**3. A handler-less child inside a handler-bearing parent.**

```jsx
// parent has a handler; child has none
<Box onClick={select}>
  <Box />
</Box>
// the click lands on the inner child
```

- All three: clicking the child fires the _parent's_ handler. The recursive raycast sweeps the child into the parent's subtree and the event bubbles to the parent — DOM-style delegation, and the exception to "handler-less = transparent."

**4. Two clickable objects stacked; click the front one (A in front, B behind, both `onClick`).**

```jsx
<Box onClick={a} /> // A — in front
<Box position={[0, 0, -1]} onClick={b} /> // B — directly behind A
// the click lands on A, which occludes B
```

- DOM: only A fires — the topmost element is the target, and B (a sibling behind, not an ancestor) is never on the bubble path.
- r3f / Threlte (depth-tunnel): A fires, then B fires too — unless A calls `stopPropagation`.
- TresJS / pmndrs (closest-hit): only A fires; B is never considered.
- This is the sharpest demonstration that "propagation" is two different motions: r3f and Threlte travel _back through depth_; the DOM and pmndrs never do.

## solid-three's event system: a chronology

solid-three began as a react-three-fiber port, and its event system has been rebuilt several times since. The history matters because one rebuild changed behaviour nobody intended, and the current state isn't one design but a fork between two.

### 2023 — inherited from r3f

The event system was ported from r3f: the `interaction` array, `eventCount`, and a single `onPointerMissed` (canvas + per-object). Early work stayed inside that model — `vorth/pointer-missed` (#8, May 2023), a Dec 2023 `onPointerMissed` bugfix.

### 2024 — tree bubbling

`add event-bubbling` (Apr 2024) made events propagate up the hit object's ancestor chain.

### Aug 2025 — the `*Missed` era, the first deliberate redesign

A burst of same-day commits split the single `onPointerMissed` into per-gesture `onClickMissed` / `onDoubleClickMissed` / `onContextMenuMissed`, computed as a _complement set_ — fire on every registered object the ray did _not_ hit, tracked via a visited set, occlusion-correct and `stopPropagation`-aware. The same rewrite introduced **per-category registries** (separate missable / hover / default registries, routed by handler type) and a movable/missable/default handler split. This is the **per-type occlusion** design: an `onWheel`-only object lived in the wheel registry, not the click registry, so clicking it did _not_ suppress the click-miss.

### Jun 2026 — #66, the source-agnostic refactor (the regression)

`#66` rebuilt dispatch around a source-agnostic `Pointer` + `EventRaycaster` + `DOMPointerManager` (so XR controllers could feed the same system) and dropped the `onMouse*` aliases — and, as collateral, **collapsed the per-category registries into one union `eventRegistry`**. Nobody chose to change occlusion semantics; the collapse served source-agnosticism. But it flipped per-type → union, reintroducing the `onWheel`-suppresses-click-miss asymmetry the per-category design had avoided. No test caught it — the suite pinned registry _routing_, not observable behaviour.

### Jun 2026 — #69 / #72, capture and typing

Pointer capture + reactive `hasPointerCapture` + the `object` / `currentObject` event API (#69); a typed dispatched event replacing the `any` bag (#72); `eventRegistry` extracted into its own refcounted module. The `*Missed` complement-set rode through all of it unchanged. This — union registry + `*Missed` — is what's merged on `next` today.

### Jun 2026 — the void fork (open)

Two branches replace `*Missed`, and they are _parallel proposals_, not a sequence — neither is an ancestor of the other, neither is merged. Both move solid-three off the r3f-shaped `*Missed` (per-object complement, both levels) toward a tres-shaped, void-only model:

- **#75 `onVoid*`** (`feat/void-events`): drop `*Missed` for a dedicated `onVoid*` canvas family (`onVoidClick`, `onVoidPointerDown`, …) — a per-gesture void handler, matching the prior-art convention of a dedicated canvas miss handler.
- **#76 `event.object`** (`feat/void-via-event-object`): drop `*Missed` and detect the void by reading `event.object` (undefined) on the ordinary canvas-level handler — the "general canvas handler carries `event.object`" model.

The open question is which void _representation_ wins. Neither restores the per-type occlusion that #66 dropped, so on the merged baseline and both proposals the `onWheel` asymmetry still stands.

### Threads through this history

- **The regression is the cautionary tale.** #66's per-type → union flip was invisible because the tests asserted _structure_ (which registry an object lands in), not _behaviour_ (does clicking an `onWheel` object suppress the miss). The exhaustive test pass should assert behaviour.
- **solid-three is the only one of the four with general canvas-level 3D handlers.** Its `<Canvas onClick>` (and every canvas pointer prop) is wired into the pointer system — a `context.props` callback fired after bubbling, carrying `event.object` (undefined on a void). r3f's and TresJS's `<Canvas onClick>` are plain DOM; Threlte has no canvas handler at all. That property is what makes #76's `event.object` model expressible — and it's unprecedented in the prior art.
- **Object override is opt-out only**, via `raycastable={false}` — like r3f, there's no way to opt a handler-less object _in_.

## Open questions

- _Occlusion._ Lean is to restore the pre-`#66` per-type intent. Open sub-question: should a front object that doesn't handle the gesture **block** (no fall-through, and count as a void) or be **transparent** (fall-through to whatever's behind)? The DOM analogy argues for block-and-count-as-miss.
- _Propagation._ Keep r3f-style z-depth tunnelling, or move to closest-hit-only like `@pmndrs/pointer-events`?
- _Override._ Stay opt-out-only (`raycastable`), or add a real per-object `pointerEvents`-style control (the one place pmndrs is clearly ahead)?
- _Miss model & delivery._ Settle on the canvas `event.object` model vs a dedicated `onVoid*` family vs restoring per-object missed. The trade: the prior-art _convention_ for the void is a _dedicated_ canvas handler (`onPointerMissed`, `@pointermissed`), which `onVoid*` matches; the general-`<Canvas onClick>`-plus-`event.object` approach is unprecedented — powerful, but you'd be first. Decide too whether per-object "not-me" is worth supporting at all, or whether only the void matters.

## Sources

All read 2026-06-09.

- **DOM:** standard behaviour — `elementFromPoint` (hit-test = geometry + `pointer-events` CSS), event bubbling along ancestors, no native "miss".
- **react-three-fiber** — `pmndrs/react-three-fiber@master`, `packages/fiber/src/core/`: `events.ts` (`EVENT_REGEX`, `pointerMissed`, the `!hits.length && delta <= 2` miss condition, `raycaster.intersectObject(obj, true)`), `utils.tsx` (`eventCount`, the `interaction.push` registration guard).
- **@pmndrs/pointer-events** (used by TresJS) — `pmndrs/xr@main`, `packages/pointer-events/src/`: `getVoidObject`, `getDominantIntersectionIndex` (closest-hit), `emitPointerEventRec` (ancestor bubble), the `pointerEvents: 'auto' | 'listener' | 'none'` resolution and `parentHasListener` propagation in `intersections/utils.ts`.
- **TresJS** — `@tresjs/core@5.8.1`: `composables/useEventManager` (VoidObject + `onPointerMissed`), `utils/pointerEvents.ts` (`supportedPointerEvents`), `core/nodeOps.ts` (`patchProp`), `components/Context.vue` + `components/TresCanvas.vue` (emits).
- **Threlte** — `@threlte/core@8.5.16` + `@threlte/extras@9.21.0`, `packages/extras/src/lib/interactivity/`: `setupInteractivity.svelte.ts` (`getHits`, `intersectObjects(interactiveObjects, true)`, per-object `pointerMissed`, `stopPropagation` / `stopImmediatePropagation`), `plugin.svelte.ts` (`interactiveObjects` registration), `context.ts` (`filter`).
