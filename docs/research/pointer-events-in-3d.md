# Pointer events in 3D: occlusion, propagation, and the miss

> Working draft. An analysis of the problem space, using react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte as prior art — then a dedicated section on solid-three's own chronology. Versions and the source files read are listed under **Sources** at the end (all 2026-06-09).

## The problem

A 2D UI toolkit gets pointer events almost for free: the browser hit-tests the DOM, picks a target, and bubbles the event up the tree. A 3D scene has none of that machinery. There's a camera, a ray, and a graph of meshes — and from that you have to define, from scratch, what "the user clicked on that" even means: which object a ray belongs to, what happens to the objects behind it, and what it means to click where there is nothing at all.

There's prior art. react-three-fiber, TresJS (through `@pmndrs/pointer-events`), and Threlte all ship pointer-event systems, and all reached for the same reference: the DOM. Reuse its vocabulary — `onClick`, bubbling, `stopPropagation`, `pointer-events: none` — so a web developer feels at home. That's a reasonable instinct and worth taking seriously. It's also worth holding at arm's length, because the goal is not DOM parity — it's a pointer-event system that is good _for 3D_. Those are different targets, and the places where they pull apart are exactly where these systems get confusing.

The core claim of this document: "pointer events" is not one decision but **three independent ones** — _occlusion_, _propagation_, and _the miss_ — and most of the confusion comes from treating them as a single bundle, or from assuming that because a system borrowed the DOM's _words_ it also borrowed the DOM's _behavior_.

## How this document is organised

Each axis is defined once, then placed for the DOM and the three prior arts in turn — one subheading per framework — and closed with a short synthesis. solid-three is deliberately held _out_ of this cross-framework comparison; its own path through the space is a dedicated chronology near the end, followed by a deep-dive on `onPointerMissed` and the design questions that remain.

The three axes:

- **Occlusion** — which objects stop the ray?
- **Propagation** — how does a hit become handler calls?
- **The miss** — how does a target learn a click didn't land on it?

## Lexicon

A handful of terms are used precisely throughout:

- **catch-all** — an object that catches the pointer ray; the ray stops at it (it's in the hit-test set). The opposite is **pass-through** — the ray goes straight through, as if the object weren't there. This is purely about whether the pointer stops here; nothing to do with rendering (a visually transparent mesh can still be a catch-all). By default the 3D libs make only handler-bearing objects catch-alls; the DOM makes all geometry a catch-all.
- **occlusion** — the axis of _which objects catch the pointer_ (and so block the ray from things behind them).
- **propagation** — the axis of _how a hit becomes handler calls_. Two motions to keep apart: **ancestor bubbling** (up the hit object's parent chain) and **z-depth tunnelling** (back through the objects stacked behind it, front-to-back). **closest-hit** = only the nearest object, no tunnelling.
- **the miss** — the axis of _how code learns a click didn't land on a target_. Two levels: **the void** (clicked empty space — nothing hit) and per-object **"not-me"** (clicked something else).
- **union vs per-type** — _union_: one handler makes an object a catch-all — it catches every gesture. _per-type_: an object catches only the gestures it actually handles (not a catch-all).
- **subtree delegation** — a handler on a parent makes its whole subtree catch the pointer; a click on a handler-less child fires the parent.
- **complement set** — "fire on every interactive object that was _not_ hit" — the set-subtraction r3f's per-object `onPointerMissed` runs (not a propagating event).

## Occlusion — which objects stop the ray?

Given a ray, which objects are even candidates to be hit — which objects are a **catch-all** for the pointer vs **pass-through**. Three sub-questions sharpen it:

- **per-type vs union:** if an object handles one gesture (`wheel`), does it catch _other_ gestures (`click`) too?
- **override:** can you flip the per-object default — a handler-less object made a catch-all, or a handler-bearing one made pass-through?
- **subtree delegation:** does a handler-less _child_ of a handler-bearing parent catch the pointer?

### DOM

All geometry catches the pointer; handlers are irrelevant to hit-testing (`elementFromPoint` is geometry plus the `pointer-events` CSS property). You opt _out_ per element with `pointer-events: none`, and get full per-element control via `auto | none`. There's no per-type notion — being a catch-all is all-or-nothing. Every element is a target, and delegation runs along ancestry.

### react-three-fiber

Only objects with at least one handler catch the pointer: a handler raises `eventCount`, which lands the object in `internal.interaction` (the array the raycaster tests). A handler-less mesh is implicitly `pointer-events: none` — pass-through. **Union:** any handler makes the object a catch-all (it catches every gesture). **Override:** opt-out only, via three's `raycast={null}`; there's no way to opt a handler-less object _in_. **Subtree:** the raycast is recursive (`intersectObject(obj, true)`), so a handler-less child of a handler-bearing parent is swept in and delegates up to it.

### TresJS / @pmndrs/pointer-events

Only objects with a listener catch the pointer by default (`pointerEvents` resolves to `'listener'`); handler-less meshes are pass-through. **Union:** any listener makes the object a catch-all. **Override:** the only system that replicates the DOM per object — `pointerEvents: 'auto' | 'listener' | 'none'` (`'auto'` a catch-all without a handler, `'none'` pass-through with one) — though in TresJS it's surfaced only incidentally — `nodeOps.patchProp` assigns the raw property onto the Object3D — not a typed/documented API. **Subtree:** a `parentHasListener` flag propagates down the tree, so descendants of an interactive object are tested.

### Threlte

Only handler-bearing objects catch the pointer (an explicit `interactiveObjects` array); handler-less meshes are pass-through. **Union:** one handler makes the object a hit-target for all event types. **Override:** a single global `filter(hits)` only — no per-object flag, and no way to opt a handler-less object in. **Subtree:** the raycast is recursive (`intersectObjects(interactiveObjects, true)`).

### Where they land

All three 3D libs **invert the DOM default**: pass-through-unless-it-has-a-handler, versus the DOM's catch-all-unless-`pointer-events:none`. They agree on **union** (any handler → catch-all — no prior-art system does _per-type_; catching only some gestures is a road solid-three alone took, in its chronology) and on **recursive subtree delegation** (a parent handler covers its whole subtree — the real exception to "handler-less = pass-through", which holds only for objects that are _not_ descendants of a handler-bearing one). They split on **override**: only the pmndrs stack restores the DOM's per-object control; r3f is opt-out-only, Threlte global-only. On this axis pmndrs is the DOM-faithful pole.

## Propagation — how a hit becomes handler calls

Once the ray hits something, whose handlers fire, in what order, and what `stopPropagation` stops. Three shapes recur: (a) **ancestor bubbling** — up the hit object's parent chain; (b) **z-depth tunnelling** — each stacked intersection front-to-back; (c) **closest-hit-only** — just the nearest object. The trap: "it bubbles like the DOM" conflates (a) and (b). They're different motions — up the tree versus back through depth.

### DOM

Ancestry only. The topmost element at the point is the target; the event captures down then bubbles up its _ancestors_. Objects spatially behind it — siblings — are never on the path. `stopPropagation` halts the bubble.

### react-three-fiber

z-depth tunnel **and** ancestor bubble. The raycast yields all stacked hits front-to-back; each is delivered, and each bubbles up its ancestors. `stopPropagation` halts _all_ farther entries — the objects stacked behind _and_ any not-yet-fired ancestors.

### TresJS / @pmndrs/pointer-events

**Closest-hit-only** plus ancestor bubble. A single dominant intersection is chosen (`getDominantIntersectionIndex`); the event fires on it and bubbles up its ancestors (`emitPointerEventRec` walks `.parent`). There is no z-depth tunnel — objects behind the nearest are never visited. `stopPropagation` simply cuts the ancestor bubble short.

### Threlte

z-depth tunnel plus ancestor bubble — the same hybrid as r3f. `getHits` walks each hit's ancestor chain, and the dispatch loop runs the flat front-to-back, child-to-ancestor list; `stopPropagation` blocks all farther entries. Threlte adds `stopImmediatePropagation()`, which reaches the _native_ DOM event — to silence sibling DOM listeners like OrbitControls — a different lever from halting in-scene propagation.

### Where they land

The DOM and pmndrs propagate along **ancestry only** (closest hit, then bubble); r3f and Threlte add **z-depth tunnelling** on top. So z-depth tunnel is the 3D _majority_ (r3f, Threlte), and closest-hit-only (pmndrs) is the _minority_ — and, again, the DOM-faithful one. The confusion isn't that tunnelling is rare; it's that it's never named as distinct from tree-bubbling.

## The miss — how a target learns a click didn't land on it

The negative signal: code learning that a click did _not_ land on a given target. It has two levels — the **void** (canvas-level: the click hit _nothing_, empty space — the deselect case) and per-object **"not-me"** (the click hit _something else_). "The void" names only the canvas-level half; "the miss" is the whole axis. (The deep mechanics of the per-object miss — and what solid-three should do about it — get their own section later; here we just place each framework.)

### DOM

No native miss. The void is read off the target: the background element is always a target, so `event.target === container` _is_ the void. There is no per-object "not-me" — selection is centralised (a click bubbles to a container and you inspect `target`), not pushed out to each object.

### react-three-fiber

**Both levels.** A canvas-level `onPointerMissed` callback fires on a total miss; per-object `onPointerMissed` fires as the _complement_ of the hit set — every interactive object that was not hit. Both are a non-propagating pass over `internal.interaction`; they ignore `stopPropagation`.

### TresJS / @pmndrs/pointer-events

**Canvas-level only**, via the VoidObject — a giant synthetic sphere parented to the scene that the ray "hits" when nothing real is hit; the miss is an ordinary `click` on it. Because the VoidObject is a single global object, it can only report "the _scene_ was missed" — there is no per-object form. (Verified: `pointerMissed` is absent from TresJS's per-object `supportedPointerEvents` allow-list, so a `@pointermissed` written on an object is silently dropped; it exists only as a `<TresCanvas>` event.)

### Threlte

**Per-object only.** It keeps r3f's per-object complement (`onpointermissed` fires on every registered object not hit) and drops the canvas-level callback — there is no canvas signal and no VoidObject. Deselect means putting `onpointermissed` on the selectable object itself.

### Where they land

The **level is forced by the representation**, and r3f is the only one that paid for both. A VoidObject is one global object → canvas-only (TresJS). A complement set is per-object by construction, with a canvas total-miss as an optional bolt-on → Threlte keeps the per-object half and drops the bolt-on. So the two r3f descendants each inherited the _opposite_ half.

A second split — **how the canvas-level miss is delivered**: the canvas-level 3D handler each system provides is singular and dedicated — at most one of them, wired only to the miss, never a general-purpose canvas handler. r3f: one dedicated `onPointerMissed` (a plain `<Canvas onClick>` is DOM). TresJS: one dedicated `@pointermissed` (`<TresCanvas>` forwards the rest of the pointer set, but those are native DOM). Threlte: none.

And one cross-axis caveat: in any **union**-occlusion system, an unrelated handler (`onWheel`) still suppresses the void, because the object counts as a hit. No miss _representation_ fixes that — only the _occlusion_ choice (per-type) does. The miss and occlusion axes are not independent.

## The landscape, at a glance

| Axis                               | DOM                                        | react-three-fiber                              | TresJS / `@pmndrs/pointer-events`                                                       | Threlte                                                                |
| ---------------------------------- | ------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Occlusion** of no-handler object | catch-all (still a target)                 | pass-through (implicit `pointer-events: none`) | pass-through by default (`pointerEvents: 'listener'`), per-object overridable           | pass-through (explicit `interactiveObjects` list)                      |
| **Per-type vs union**              | n/a (all-or-nothing)                       | union (any handler → catch-all)                | union (any listener → catch-all; `pointerEvents` is per-object, not per-type)           | union (one handler → hit-target for all types)                         |
| **Override** (opt-in / opt-out)    | full: `pointer-events: auto \| none`       | opt-out only (`raycast={null}`)                | full: `pointerEvents: auto \| listener \| none` (via the pmndrs layer, not first-class) | global `filter(hits)` only                                             |
| **Subtree delegation**             | yes (geometry + ancestry)                  | yes (recursive raycast)                        | yes (`parentHasListener`)                                                               | yes (recursive raycast)                                                |
| **Propagation**                    | ancestors only                             | z-depth tunnel + ancestor bubble               | **closest hit only** + ancestor bubble                                                  | z-depth tunnel + ancestor bubble                                       |
| **The miss**                       | none native (read `target === background`) | `onPointerMissed`: canvas **and** per-object   | VoidObject (canvas-level only); a positive hit on a synthetic sphere                    | per-object `onpointermissed` **only** — no canvas-level, no VoidObject |

Two clusters fall out of it. **r3f and Threlte are nearly the same system** — union occlusion, z-depth-tunnel + ancestor-bubble propagation, per-object `onPointerMissed` (their lone miss-axis difference: r3f _also_ fires a canvas-level miss callback, which Threlte drops). `@pmndrs/pointer-events` (and thus TresJS) is the real outlier: closest-hit-only propagation, the VoidObject, and the only true per-object override. So the "mainstream 3D" model is r3f's, and pmndrs is the one genuine alternative — and it's also the most DOM-faithful on every axis (closest-hit ≈ DOM occlusion, VoidObject ≈ the always-a-target document, `pointerEvents` ≈ the CSS property).

## Where the confusion comes from

_The specific conflations to name and defuse:_

- "It bubbles like the DOM" → assumed ancestor propagation, but r3f and Threlte move along z-depth too.
- "Missed = no handler ran" → actually "no _interactive object_ was hit"; an object with an unrelated handler counts as a hit.
- "No handler = harmless" → it's `pointer-events: none`; the object vanishes from hit-testing entirely (so a click can fall through it to whatever's behind).
- "Handler-less = always pass-through" → true only for non-descendants; a handler-less _child_ of an interactive parent is swept in by the recursive raycast and delegates up to it.
- "The void is the miss" → the void is only the canvas-level half; per-object "missed" fires on a real hit elsewhere.
- "Borrowed the words = borrowed the behavior" → the DOM vocabulary is reused even where the behavior diverges.

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

- All three: clicking the child fires the _parent's_ handler. The recursive raycast sweeps the child into the parent's subtree and the event bubbles to the parent — DOM-style delegation, and the exception to "handler-less = pass-through."

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

## `onPointerMissed`: what it is, and what solid-three should offer instead

Two questions the rest of the doc leads up to: **what is an `onPointerMissed` event, really?** — and, given the answer, **should solid-three implement it, or offer something else for the same job?**

### It isn't an event — it's a complement

A normal pointer event begins at a hit and _propagates_ — back through depth, up the tree — and `stopPropagation` can halt it. `onPointerMissed` does neither. On every click r3f runs a separate pass: for each interactive object, fire its `onPointerMissed` if that object was _not_ among the hit objects.

```js
// conceptually, on every click — not propagation, a set-subtraction:
for (const obj of interaction) {
  if (!hitObjects.includes(obj)) obj.onPointerMissed?.(event)
}
```

It reads no `stopped` flag and walks no chain. It's the _complement of the hit set_ — "fire on everyone who wasn't hit." And that one shape quietly bundles two different questions:

- **the void** — _nobody_ was hit (you clicked empty space); every object's `onPointerMissed` fires.
- **not-me** — _someone else_ was hit; every object except the hit ones fires.

So "what is `onPointerMissed`?" — it's a non-propagating, per-object _deselection_ notification, computed by subtracting the hit set from the interactive set. Not an event in the propagation model; a derived signal bolted alongside it.

### The self-disqualification gotcha

Because the complement is taken over the _interactive_ set, and because `onPointerMissed` _itself_ makes an object interactive (it raises `eventCount`), a parent is silently excluded from its own children's clicks. Walk it:

```jsx
// OUTER is interactive *because* onPointerMissed counts toward eventCount
<Box onPointerMissed={deselect}>
  <Box onClick={select} />
</Box>
```

```
click INNER:
  ray hits INNER's geometry
  bubble up through handlers  →  hitObjects = [INNER, OUTER]   (OUTER has a handler)
  complement = interaction − hitObjects = []                   (OUTER is in hitObjects)
  ⇒ OUTER.onPointerMissed does NOT fire
```

The property that makes OUTER _eligible_ for a miss (it has a handler) is the same property that makes it count as _hit_ on any subtree click (it has a handler, so it bubbles into the hit set). A parent therefore only misses on the _true void_, never on its own descendants — a rule nobody writes down and everybody trips over. `stopPropagation` doesn't enter into it: the missed pass ignores `stopped` entirely.

### The problem underneath: deselection

Strip the mechanism away and the real need is just deselection. `onPointerMissed` pushes you toward a _decentralized_ shape — every selectable object owns a boolean and listens for "not-me":

```jsx
function Selectable() {
  const [selected, setSelected] = createSignal(false)
  return (
    <Box
      onClick={e => {
        e.stopPropagation()
        setSelected(true)
      }}
      onPointerMissed={() => setSelected(false)}
    />
  )
}
```

It works, but the selection state is scattered across the scene, every object pays for the complement pass, and each inherits the self-disqualification rule.

The same problem-space, solved the way Solid already wants — **selection is one signal; the void clears it:**

```jsx
const [selected, setSelected] = createSignal()

// selecting is a positive click; the void deselects
<Canvas onPointerDown={e => { if (!e.object) setSelected(undefined) }}>
  <Box onPointerDown={e => { e.stopPropagation(); setSelected("a") }} />
  <Box onPointerDown={e => { e.stopPropagation(); setSelected("b") }} />
</Canvas>

// each box re-derives its own state — no "not-me" notification needed:
const isSelectedA = () => selected() === "a"
```

The "not-me" case _disappears_: box B never needs to be _told_ that A was clicked — it re-derives `selected() === "b"` reactively. Selecting is an ordinary positive click (with `stopPropagation` so it doesn't reach the canvas); deselecting is the void clearing the signal.

### What solid-three should offer

**No to the per-object half; yes to the void.**

- **Per-object "not-me" (`*Missed`) — don't bring it back.** It's the expensive, surprising half: a non-propagating complement pass with the self-disqualification trap, and it nudges users toward decentralized selection state. A centralized signal plus a void event covers everything it did, more clearly. solid-three already dropped it on both void branches — this is the case for keeping it gone.
- **The void — keep it, first-class.** This is the genuinely 3D-specific need: a DOM page always has a background element to click; a 3D scene has nothing under empty space, so there is no event to read unless the framework manufactures one. The void _signal_ is settled; only its _representation_ is open (the open questions).

The thing to protect is that the void stays _cheap and ergonomic_, because it now carries the whole deselection story `onPointerMissed` used to. Both branches clear that bar: clicking the void is an ordinary canvas-level dispatch (it does not raycast the scene — see the chronology), and `!event.object` or `onVoidPointerDown` is a one-liner.

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

- _Occlusion._ Lean is to restore the pre-`#66` per-type intent. Open sub-question: should a front object that doesn't handle the gesture **block** (no fall-through, and count as a void) or be **pass-through** (fall-through to whatever's behind)? The DOM analogy argues for block-and-count-as-miss.
- _Propagation._ Keep r3f-style z-depth tunnelling, or move to closest-hit-only like `@pmndrs/pointer-events`?
- _Override._ Stay opt-out-only (`raycastable`), or add a real per-object `pointerEvents`-style control (the one place pmndrs is clearly ahead)?
- _Void representation._ The per-object "not-me" question is settled above (drop it). What's left is how the void is delivered: `event.object === undefined` on the ordinary canvas handler (#76) vs a dedicated `onVoid*` family (#75). The prior-art _convention_ is a dedicated canvas handler (`onPointerMissed`, `@pointermissed`), which `onVoid*` matches; the `event.object` approach is unprecedented — powerful, but you'd be first.

## Sources

All read 2026-06-09.

- **DOM:** standard behaviour — `elementFromPoint` (hit-test = geometry + `pointer-events` CSS), event bubbling along ancestors, no native "miss".
- **react-three-fiber** — `pmndrs/react-three-fiber@master`, `packages/fiber/src/core/`: `events.ts` (`EVENT_REGEX`, `pointerMissed`, the `!hits.length && delta <= 2` miss condition, `raycaster.intersectObject(obj, true)`), `utils.tsx` (`eventCount`, the `interaction.push` registration guard).
- **@pmndrs/pointer-events** (used by TresJS) — `pmndrs/xr@main`, `packages/pointer-events/src/`: `getVoidObject`, `getDominantIntersectionIndex` (closest-hit), `emitPointerEventRec` (ancestor bubble), the `pointerEvents: 'auto' | 'listener' | 'none'` resolution and `parentHasListener` propagation in `intersections/utils.ts`.
- **TresJS** — `@tresjs/core@5.8.1`: `composables/useEventManager` (VoidObject + `onPointerMissed`), `utils/pointerEvents.ts` (`supportedPointerEvents`), `core/nodeOps.ts` (`patchProp`), `components/Context.vue` + `components/TresCanvas.vue` (emits).
- **Threlte** — `@threlte/core@8.5.16` + `@threlte/extras@9.21.0`, `packages/extras/src/lib/interactivity/`: `setupInteractivity.svelte.ts` (`getHits`, `intersectObjects(interactiveObjects, true)`, per-object `pointerMissed`, `stopPropagation` / `stopImmediatePropagation`), `plugin.svelte.ts` (`interactiveObjects` registration), `context.ts` (`filter`).
