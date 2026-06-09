# Pointer events in 3D: occlusion, propagation, and the miss

> Working draft. An analysis of the problem space, using react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte as prior art — then a dedicated section on solid-three's own chronology. Versions and the source files read are listed under **Sources** at the end (all 2026-06-09).

## The problem

A 2D UI toolkit gets pointer events almost for free: the browser hit-tests the DOM, picks a target, and bubbles the event up the tree. A 3D scene has none of that machinery. There's a camera, a ray, and a graph of meshes — and from that you have to define, from scratch, what "the user clicked on that" even means: which object a ray belongs to, what happens to the objects behind it, and what it means to click where there is nothing at all.

Concretely, here is the picture to hold onto. Every pointer interaction starts as a ray shot from the camera, through the cursor, into the scene — and that ray can pass through several meshes lined up in depth: the nearest, then whatever sits behind it, and so on. Three questions fall out of that and never go away:

1. Of the things the ray passes through, which does it actually _stop_ at — which ones count as "clickable"?
2. When you click one, what happens to the ones behind it — does the click reach them too?
3. When the ray hits _nothing at all_ — you clicked empty space — how does anything find out?

That last question is the basis of **deselection**: clicking empty space to clear a selection, the way clicking your desktop background deselects a file. In a 3D scene an empty-space click hits nothing, so there is no event to catch unless the framework manufactures one — which is exactly where `onPointerMissed` will come in.

There's prior art. react-three-fiber, TresJS (through `@pmndrs/pointer-events`), and Threlte all ship pointer-event systems, and all reached for the same reference: the DOM. (Two of them share an origin: react-three-fiber and the standalone `@pmndrs/pointer-events` that TresJS builds on both come from the **pmndrs** group — the doc calls them **r3f** and **pmndrs**.) Reuse its vocabulary — `onClick`, bubbling, `stopPropagation`, `pointer-events: none` — so a web developer feels at home. That's a reasonable instinct and worth taking seriously. It's also worth holding at arm's length, because the goal is not DOM parity — it's a pointer-event system that is good _for 3D_. Those are different targets, and the places where they pull apart are exactly where these systems get confusing.

The core claim of this document: "pointer events" is not one decision but **three independent ones** — _occlusion_, _propagation_, and _the miss_ — and most of the confusion comes from treating them as a single bundle, or from assuming that because a system borrowed the DOM's _words_ it also borrowed the DOM's _behavior_.

But the taxonomy is in service of one concrete question — the reason this document exists: **what is `onPointerMissed`, the one inherited primitive solid-three has redesigned again and again (issue #21, the `*Missed` split, the `onVoid*`/`event.object` fork)?** The analysis below works toward a precise answer to that: `onPointerMissed` isn't really an event at all — it's a non-propagating _deselection_ shortcut that bundles two unlike needs (clicking **the void** — empty space — and learning that **something else** was clicked). Whether solid-three keeps it, and in what form, is a live decision; this document's job is to make the space precise, not to pick.

## How this document is organised

Each axis is defined once, then placed for the DOM and the three prior arts in turn — one subheading per framework — and closed with a short synthesis. solid-three is deliberately held _out_ of this cross-framework comparison; its own path through the space is a dedicated chronology near the end, followed by a deep-dive on `onPointerMissed` and the design questions that remain.

The three axes:

- **Occlusion** — which objects stop the ray?
- **Propagation** — how does a hit become handler calls?
- **The miss** — how does a target learn a click didn't land on it?

## Lexicon

A handful of terms are used precisely throughout:

- **gesture** — one kind of pointer event: `click`, `wheel`, `contextmenu`, `pointermove`, and so on.
- **catch-all** — an object that catches the pointer ray: the ray stops at it (it's in the set of objects the ray is tested against). Purely about whether the pointer stops here — nothing to do with rendering (a visually transparent mesh can still be a catch-all). By default the 3D libs make only handler-bearing objects catch-alls; the DOM makes all geometry a catch-all.
- **pass-through** — the opposite of a catch-all: the ray goes straight through the object, as if it weren't there.
- **occlusion** — the axis of _which objects catch the pointer_ (and so block the ray from things behind them).
- **propagation** — the axis of _how a hit becomes handler calls_: which handlers fire, and in what order. Three motions recur:
  - **ancestor bubbling** — the event travels _up the hit object's parent chain_ (as in the DOM).
  - **z-depth tunnelling** — the event travels _back through the objects stacked behind_ the hit, nearest first.
  - **closest-hit** — only the nearest object is delivered to; no tunnelling.
- **the miss** — the axis of _how code learns a click didn't land on a target_. Two levels: **the void** (clicked empty space — nothing hit) and per-object **"not-me"** (clicked some _other_ object).
- **union vs per-type** — _union_: one handler makes an object a catch-all — it catches every gesture. _per-type_: an object catches only the gestures it actually handles (not a catch-all).
- **subtree delegation** — a handler on a parent makes its whole subtree catch the pointer; a click on a handler-less child fires the parent.
- **complement set** — the interactive objects a click did _not_ hit: everything except what was clicked. (The per-object "missed" event, introduced later, fires on exactly this set.)

## Occlusion — which objects stop the ray?

Given a ray, which objects are even candidates to be hit — which objects are a **catch-all** for the pointer vs **pass-through**. Three sub-questions sharpen it:

- **per-type vs union:** if an object handles one gesture (`wheel`), does it catch _other_ gestures (`click`) too?
- **override:** can you flip the per-object default — a handler-less object made a catch-all, or a handler-bearing one made pass-through?
- **subtree delegation:** does a handler-less _child_ of a handler-bearing parent catch the pointer?

### DOM

All geometry catches the pointer — handlers are irrelevant to hit-testing (the browser tests geometry plus the `pointer-events` CSS property), so a handler-less element still stops the pointer.

- **Per-type or union?** N/A — an element catches every gesture, or (with `pointer-events: none`) none; there's no per-gesture distinction.
- **Override?** Full, per element — `pointer-events: auto | none`.
- **Subtree?** Yes — every element is a catch-all, and delegation runs up the ancestor chain.

### react-three-fiber

Only objects with at least one handler catch the pointer — adding a handler bumps an internal counter (`eventCount`) above zero, which puts the object in the list the ray is tested against (`internal.interaction`); a handler-less mesh is pass-through.

- **Per-type or union?** Union — one handler of _any_ type catches every gesture (an `onWheel`-only box still stops a `click`).
- **Override?** Opt-out only — `raycast={null}` makes a handler-bearing object pass-through; there's no way to opt a handler-less one _in_.
- **Subtree?** Caught — the ray test is recursive, so a handler-less child inside a handler-bearing parent is swept in and its clicks delegate up to the parent.

### TresJS / @pmndrs/pointer-events

Only objects with a listener catch the pointer by default; a handler-less mesh is pass-through.

- **Per-type or union?** Union — any listener makes the object a catch-all.
- **Override?** Full, per object — `pointerEvents: 'auto' | 'listener' | 'none'` (`'auto'` = catch-all without a handler, `'none'` = pass-through with one). The only system that matches the DOM here, though in TresJS it's surfaced only incidentally (the raw property is assigned onto the object), not a typed/documented API.
- **Subtree?** Caught — an "is interactive" flag propagates down the tree, so descendants of a handler-bearing object are tested.

### Threlte

Only handler-bearing objects catch the pointer (an explicit `interactiveObjects` list); a handler-less mesh is pass-through.

- **Per-type or union?** Union — one handler makes the object a hit-target for all event types.
- **Override?** Global only — a single `filter(hits)` function, with no per-object flag and no way to opt a handler-less object _in_.
- **Subtree?** Caught — the ray test is recursive over the interactive list and its descendants.

### Where they land

All three 3D libs **invert the DOM default**: pass-through-unless-it-has-a-handler, versus the DOM's catch-all-unless-`pointer-events:none`. They agree on **union** (any handler → catch-all — no prior-art system does _per-type_; catching only some gestures is a road solid-three alone took, in its chronology) and on **recursive subtree delegation** (a parent handler covers its whole subtree — the real exception to "handler-less = pass-through", which holds only for objects that are _not_ descendants of a handler-bearing one). They split on **override**: only the pmndrs stack restores the DOM's per-object control; r3f is opt-out-only, Threlte global-only. On this axis pmndrs is the DOM-faithful pole — the end of the spectrum that behaves most like the DOM.

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

#### The level is forced by the representation

r3f is the only one that paid for both levels. A VoidObject is one global object, so it can only report "the _scene_ was missed" → canvas-only (TresJS). The per-object complement is per-object by construction, with a canvas total-miss available only as a bolt-on → Threlte keeps the per-object half and drops the bolt-on. So the two r3f descendants each inherited the _opposite_ half.

#### Delivery: at most one dedicated canvas handler

The canvas-level 3D handler each system provides is singular and dedicated — wired only to the miss, never a general-purpose canvas handler. r3f: one dedicated `onPointerMissed` (a plain `<Canvas onClick>` is DOM). TresJS: one dedicated `@pointermissed` (`<TresCanvas>` forwards the rest of the pointer set, but those are native DOM). Threlte: none.

#### The miss and occlusion axes are not independent

In any **union**-occlusion system, an unrelated handler (`onWheel`) still suppresses the void, because the object counts as a hit. No miss _representation_ fixes that — only the _occlusion_ choice (per-type) does.

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

Four concrete scenes, across the DOM and the prior art (solid-three's behaviour lives in its own section). In the snippets, `<Box>` / `<Text>` are 3D mesh components and `<Canvas>` is the scene root.

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

## `onPointerMissed`: what it actually is

What _is_ an `onPointerMissed` event, mechanically? The rest of this section answers that — and the short version is that it isn't an event at all. (What solid-three should _do_ about it is left open, in Open questions.)

### It isn't an event — it's a complement

A normal pointer event begins at a hit and _propagates_ — back through depth, up the tree — and `stopPropagation` can halt it. `onPointerMissed` does neither. On every click r3f runs a separate pass: for each interactive object, fire its `onPointerMissed` if that object was _not_ among the hit objects.

```js
// conceptually, on every click — fire on every interactive object NOT hit:
for (const obj of interaction) {
  if (!hitObjects.includes(obj)) obj.onPointerMissed?.(event)
}
```

It reads no `stopped` flag and walks no chain. It's the _complement of the hit set_ — "fire on everyone who wasn't hit." And that one shape quietly bundles two different questions:

- **the void** — _nobody_ was hit (you clicked empty space); every object's `onPointerMissed` fires.
- **not-me** — _someone else_ was hit; every object except the hit ones fires.

So "what is `onPointerMissed`?" — it's a non-propagating, per-object _deselection_ notification: it fires on every interactive object _except_ the ones the click hit. Not an event in the propagation model; a derived signal bolted alongside it.

### The self-disqualification gotcha

Because the miss fires on every interactive object _except_ the ones hit, and because `onPointerMissed` _itself_ makes an object interactive (it raises `eventCount`), a parent is silently excluded from its own children's clicks. Walk it:

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

The property that makes OUTER _eligible_ for a miss (it has a handler) is the same property that makes it count as _hit_ on any subtree click (it has a handler, so it bubbles into the hit set). A parent therefore only misses on the _true void_, never on its own descendants — a non-obvious consequence of `onPointerMissed` raising `eventCount`. `stopPropagation` doesn't enter into it: the missed pass ignores `stopped` entirely.

### The problem underneath: deselection

Strip the mechanism away and the need `onPointerMissed` serves is deselection. There are two shapes for it. With `onPointerMissed`, it's _decentralized_ — each selectable object owns a boolean and listens for "not-me":

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

The selection state is then spread across the scene, every object is part of the complement pass, and each is subject to the self-disqualification rule above.

The same need can also be _centralized_ — **one signal, cleared by the void:**

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

In this shape the "not-me" notification isn't needed: box B re-derives `selected() === "b"` reactively rather than being _told_ A was clicked. Selection is set by a positive click (with `stopPropagation`); deselection is the void clearing the signal. The two shapes have different properties — decentralized scatters state and pays the complement pass; centralized concentrates state and leans on the void — and which fits a given app is a design choice, not something this document settles.

### Where it came from (in r3f)

`onPointerMissed` entered r3f in two stages, which is why it does two things. The **canvas** form came first (drcmda, 2019-08-06, commit `3871afba`), firing only on a click that hit nothing — the deselect / click-empty-space signal: a 3D click on empty space hits nothing and produces no event, where a DOM page gets the same affordance for free (a background click bubbles to `document`). The **per-object** form was a separate, later addition (drcmda, 2020-12-03, commit `15b348b0`, "allow onPointerMissed on the object level"), firing on a mesh when you click anything but it. r3f's docs and downstream issues motivate the canvas form; the per-object form's rationale is undocumented. (`onPointerMissed` is r3f-original — the earlier `react-three-renderer`, 2015, had no pointer-raycasting at all.)

## solid-three's event system: a chronology

solid-three began as a react-three-fiber port, and its event system has been rebuilt several times since. The history matters because one rebuild changed behaviour as an unintended side effect, and the current state isn't one design but a fork between two. (This section is project history — skip it unless you want solid-three's specific path; hashes and dates are from the un-squashed `next-dirty` history.)

### 2023 — a 1:1 r3f port

solid-three began as a close port of r3f, down to the `solid-zustand` store: the `interaction` array, `eventCount`, `onPointerMissed`, and r3f's **full** propagation — z-depth tunnel _and_ ancestor bubble (`src/core/events.ts` carries r3f's bubble loop verbatim). `onPointerMissed` arrived via `vorth/pointer-missed` (PR #8, merge `dd794de1`, 2023-05-22; closes issue **#7**), with a follow-up bugfix that December. The later zustand → `solid-js/store` migration (`f8bc3716`, 2023-07-16) left the bubbling untouched. (This port still lives on `main`.)

### 2024 — a from-scratch rewrite re-adds bubbling

The current solid-three does **not** descend from that port; it descends from a separate, from-scratch rewrite (the flat `src/` layout, no `zustand`) that branched off at the PR #8 merge (`dd794de1`) and re-implemented events. `cc02bab4` (2024-04-11) deleted `src/core/events.ts` and added a flat `src/events.ts` with **no bubbling at all**; `8d1acba3` ("add event-bubbling", 2024-04-15) added the ancestor walk back — re-establishing what the original port had had all along, not introducing anything new. The two lines are genuinely parallel: `git merge-base` confirms the port tip is _not_ an ancestor of the rewrite, and `next` descends from the rewrite, not the port.

### Aug 2025 — the `*Missed` era, the first deliberate redesign

A burst of same-day commits (2025-08-04) split the single `onPointerMissed` into per-gesture `onClickMissed` / `onDoubleClickMissed` / `onContextMenuMissed` (`80f579c6`, `7148625d`), computed as a _complement set_ — fire on every registered object the ray did _not_ hit, occlusion-correct and `stopPropagation`-aware. The same pass (`a0ffc80f`) introduced **per-category registries** (separate missable / hover / default registries, routed by handler type) — the **per-type occlusion** design: an `onWheel`-only object lived in the wheel registry, not the click registry, so clicking it did _not_ suppress the click-miss.

### Jun 2026 — #66, the source-agnostic refactor (the regression)

`#66` (`c5db8e28`, 2026-06-05) rebuilt dispatch around a source-agnostic `Pointer` + `EventRaycaster` + `DOMPointerManager` (so XR controllers could feed the same system) and dropped the `onMouse*` aliases — and, as collateral, **collapsed the per-category registries into one union `eventRegistry`** (`addEventListener(object, _type)` now ignores `_type`). Changing occlusion semantics wasn't the goal; the collapse served source-agnosticism. But it flipped per-type → union, reintroducing the `onWheel`-suppresses-click-miss asymmetry the per-category design had avoided. No test caught it — the suite pinned registry _routing_, not observable behaviour.

### Jun 2026 — #69 / #72, capture and typing

Pointer capture + reactive `hasPointerCapture` + the `object` / `currentObject` event API (#69, `2f321abe`, 2026-06-07); a typed dispatched event replacing the `any` bag (#72, `0c61cbc0`, 2026-06-07). The `*Missed` complement-set rode through both unchanged. This — union registry + `*Missed` — is what's merged on `next` today.

### Jun 2026 — the void fork (open)

Two branches replace `*Missed` — both 2026-06-08, both forking off `5e7875f`, both **unmerged**. They are _parallel proposals_, not a sequence: `git merge-base --is-ancestor` confirms neither is an ancestor of the other. Both move solid-three off the r3f-shaped `*Missed` (per-object complement, both levels) toward a tres-shaped, void-only model:

- **#75 `onVoid*`** (`feat/void-events`; `d25e9e3d`, `b1671bcb`): drop `*Missed` for a dedicated `onVoid*` canvas family (`onVoidClick`, `onVoidPointerDown`, …) — a per-gesture void handler, matching the prior-art convention of a dedicated canvas miss handler.
- **#76 `event.object`** (`feat/void-via-event-object`; `dad769e`): drop `*Missed` and detect the void by reading `event.object` (undefined) on the ordinary canvas-level handler — the "general canvas handler carries `event.object`" model.

The open question is which void _representation_ wins. Neither restores the per-type occlusion that #66 dropped, so on the merged baseline and both proposals the `onWheel` asymmetry still stands.

### Threads through this history

- **The regression is the cautionary tale.** #66's per-type → union flip was invisible because the tests asserted _structure_ (which registry an object lands in), not _behaviour_ (does clicking an `onWheel` object suppress the miss). The exhaustive test pass should assert behaviour.
- **solid-three is the only one of the four with general canvas-level 3D handlers.** Its `<Canvas onClick>` (and every canvas pointer prop) is wired into the pointer system — a `context.props` callback fired after bubbling, carrying `event.object` (undefined on a void). r3f's and TresJS's `<Canvas onClick>` are plain DOM; Threlte has no canvas handler at all. That property is what makes #76's `event.object` model expressible — and it's unprecedented in the prior art.
- **Object override is opt-out only**, via `raycastable={false}` — like r3f, there's no way to opt a handler-less object _in_.

## Open questions

- _Occlusion: per-type vs union._ `#66` collapsed per-type into union. Whether to restore per-type is open — and if per-type, whether a front object that doesn't handle the gesture should **block** (no fall-through, count as a void) or be **pass-through** (fall-through to whatever's behind). (The DOM is union-occlusion with no fall-through.)
- _Propagation._ Keep r3f-style z-depth tunnelling, or move to closest-hit-only like `@pmndrs/pointer-events`?
- _Override._ Stay opt-out-only (`raycastable`), or add a per-object `pointerEvents`-style control (pmndrs is the only prior art with one)?
- _Miss model._ Two open parts: (a) whether per-object "not-me" is worth supporting at all, or only the void; and (b) how the void is delivered — `event.object === undefined` on the ordinary canvas handler (#76) vs a dedicated `onVoid*` family (#75). The prior-art _convention_ for the void is a dedicated canvas handler (`onPointerMissed`, `@pointermissed`), which `onVoid*` matches; the `event.object` approach has no prior-art precedent.

## Sources

All read 2026-06-09.

- **DOM:** standard behaviour — `elementFromPoint` (hit-test = geometry + `pointer-events` CSS), event bubbling along ancestors, no native "miss".
- **react-three-fiber** — `pmndrs/react-three-fiber@master`, `packages/fiber/src/core/`: `events.ts` (`EVENT_REGEX`, `pointerMissed`, the `!hits.length && delta <= 2` miss condition, `raycaster.intersectObject(obj, true)`), `utils.tsx` (`eventCount`, the `interaction.push` registration guard).
- **@pmndrs/pointer-events** (used by TresJS) — `pmndrs/xr@main`, `packages/pointer-events/src/`: `getVoidObject`, `getDominantIntersectionIndex` (closest-hit), `emitPointerEventRec` (ancestor bubble), the `pointerEvents: 'auto' | 'listener' | 'none'` resolution and `parentHasListener` propagation in `intersections/utils.ts`.
- **TresJS** — `@tresjs/core@5.8.1`: `composables/useEventManager` (VoidObject + `onPointerMissed`), `utils/pointerEvents.ts` (`supportedPointerEvents`), `core/nodeOps.ts` (`patchProp`), `components/Context.vue` + `components/TresCanvas.vue` (emits).
- **Threlte** — `@threlte/core@8.5.16` + `@threlte/extras@9.21.0`, `packages/extras/src/lib/interactivity/`: `setupInteractivity.svelte.ts` (`getHits`, `intersectObjects(interactiveObjects, true)`, per-object `pointerMissed`, `stopPropagation` / `stopImmediatePropagation`), `plugin.svelte.ts` (`interactiveObjects` registration), `context.ts` (`filter`).
