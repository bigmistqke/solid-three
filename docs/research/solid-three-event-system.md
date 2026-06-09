# solid-three's pointer-event system: a chronology

> Companion to [Pointer events in 3D](./pointer-events-in-3d.md), which maps the design space — occlusion, propagation, the miss — across the DOM, react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte. Read that first; this document reuses its vocabulary (the void, catch-all / pass-through, the r3f and pmndrs/tres camps) without re-deriving it — except _per-type vs union_, which is solid-three's own deviation and is defined below.

solid-three's pointer-event system was built the way most are: ported from react-three-fiber, then rewritten and re-rewritten — each time _without_ the design-space analysis the companion document lays out. This chronology records what the semantics actually _were_ at each stage, and the behaviour that _emerged_ from those rebuilds: some of it chosen deliberately, some of it not — most starkly, an occlusion flip nobody intended or noticed. It is the case study for why mapping the space first is worth doing.

Commit hashes and dates below are from the un-squashed history (`next-dirty`).

## 2023 — a 1:1 r3f port

solid-three began as a close port of r3f, and so did its event system: a single `interaction` array (**union** occlusion), `eventCount`, `onPointerMissed`, and r3f's **full** propagation — z-depth tunnel _and_ ancestor bubble. `onPointerMissed` arrived via PR #8 (`dd794de1`, 2023-05-22).

## 2024 — rebuilt from scratch: bubbling lost then restored, occlusion quietly per-type

In 2024 the event system was rebuilt from scratch (the flat `src/` layout). `cc02bab4` (2024-04-11) replaced it with a flat `src/events.ts` that had **no bubbling at all** and no `onPointerMissed`; `8d1acba3` ("add event-bubbling", 2024-04-15) added the ancestor walk back. So for a few days the event system had no propagation up the tree, then regained it.

The rewrite also changed occlusion — though no commit says so. Its `eventRegistry` was a dict keyed by event type: one object list per gesture (`eventRegistry.onClick`, `eventRegistry.onWheel`, …), and a click raycast only its own bucket (`intersectObjects(eventRegistry[type], true)`). An `onWheel`-only object was therefore never in the `onClick` bucket. That flipped occlusion from the **union** the 2023 port inherited from r3f (any handler ⇒ hittable by every gesture) to **per-type** (hittable only for the gestures it handles) — an emergent property of keying the registry by type, not a decision anyone recorded. The effect stayed invisible until `*Missed` arrived to expose it (next section).

## Aug 2025 — the `*Missed` era, the first deliberate redesign

A burst of same-day commits (2025-08-04) brought the miss back — and split it per gesture. `onPointerMissed` (dropped in the rewrite) returned as `onClickMissed` / `onDoubleClickMissed` / `onContextMenuMissed` (`80f579c6`, `7148625d`), each firing on every registered object a click _didn't_ land on — so a selectable object can hear "something else was clicked" and deselect itself (see _Deselection_, below). Unlike r3f's miss, these respect `stopPropagation`. The same pass (`a0ffc80f`) regrouped the registries by behaviour (missable / movable / default) but kept them keyed per type.

`*Missed` is also what made solid-three's **per-type occlusion** — in place since the 2024 rewrite — finally observable. Click the second box:

```jsx
<Canvas onClickMissed={() => deselect()}>
  <Box onClick={...} />   // A — handles clicks
  <Box onWheel={...} />   // B — handles the wheel, nothing else
</Canvas>
```

Everywhere else — r3f, TresJS, Threlte — **one handler of any kind makes an object catch every gesture** ("union"): B catches your _click_ even though it only wants the wheel, so the canvas counts a hit rather than a miss, `onClickMissed` doesn't fire, and `deselect()` doesn't run. solid-three is **per-type**: B sits only in the `onWheel` bucket, a click ray never tests it, the click hits nothing, `onClickMissed` fires, and `deselect()` runs.

Was this _better_? Not clearly — arguably not at all. Union's behaviour (a click on a visible `onWheel` object is a hit, so it doesn't deselect) is a defensible default; per-type lets clicks fall _through_ objects that don't happen to handle them, which can surprise just as much the other way. Per-type's one clear edge is performance: each gesture raycasts only its own, smaller bucket, not every handler-bearing object. Either way, nobody had decided it — and an undecided behaviour is an easily-lost one. The next section is how.

## Jun 2026 — #66, the source-agnostic refactor (a silent occlusion flip)

`#66` (`c5db8e28`, 2026-06-05) rebuilt dispatch around a source-agnostic `Pointer` + `EventRaycaster` + `DOMPointerManager` (so XR controllers could feed the same system) and dropped the `onMouse*` aliases. As collateral, it **collapsed the per-gesture registries back into one** — every handler object went into a single `eventRegistry` again, regardless of gesture (`addEventListener(object, _type)` now ignores `_type`).

That flipped occlusion back to union (the model from the previous section): click the `onWheel` box and `deselect()` no longer fires. Changing occlusion wasn't the goal — the collapse served source-agnosticism, and the flip was a side effect.

The point isn't that union is worse than per-type — it's that a whole axis of behaviour changed and **nothing noticed**. No test caught it: the suite pinned _which registry_ an object lands in (routing), not _what happens when you click_ (behaviour). Occlusion flipped invisibly, on a refactor that wasn't even about occlusion.

## Jun 2026 — #69 / #72, capture and typing

Pointer capture + reactive `hasPointerCapture` + the `object` / `currentObject` event API (#69, `2f321abe`, 2026-06-07); a typed dispatched event replacing the `any` bag (#72, `0c61cbc0`, 2026-06-07). The `*Missed` handlers rode through both unchanged. This — union registry + `*Missed` — is what's merged on `next` today.

## Jun 2026 — the void fork (open)

Two **unmerged** branches (both 2026-06-08) propose replacing `*Missed` — _parallel proposals_, not a sequence. Both move solid-three off the r3f-shaped `*Missed` (per-object miss, both levels) toward a tres-shaped, void-only model. They differ only in how you ask for the void:

```jsx
// #75 (feat/void-events; d25e9e3d, b1671bcb) — a dedicated canvas handler per gesture
<Canvas onVoidClick={() => deselect()} />

// #76 (feat/void-via-event-object; dad769e) — the ordinary canvas handler; void = no object
<Canvas onClick={e => { if (!e.object) deselect() }} />
```

#75's `onVoid*` family matches the prior-art convention of a dedicated canvas miss handler (`onPointerMissed`, `@pointermissed`). #76's `event.object` reading has no prior-art precedent — it works only because solid-three wires `<Canvas>` handlers into the pointer system (see _Threads_).

The open question is which void _representation_ wins. Neither restores the per-type occlusion that #66 dropped, so on the merged baseline and both proposals an `onWheel` object still catches clicks (union).

## Deselection — the two shapes

`*Missed` exists to serve one need: **deselection**. It has two shapes, and which one an app uses decides whether per-object "not-me" is needed at all.

**Decentralized** — each selectable object owns a boolean and listens for its own miss via `*Missed`:

```jsx
function Selectable() {
  const [selected, setSelected] = createSignal(false)
  return (
    <Box
      onClick={e => {
        e.stopPropagation()
        setSelected(true)
      }}
      onClickMissed={() => setSelected(false)}
    />
  )
}
```

Selection state is scattered across the scene, and every selectable object is checked on each click.

**Centralized** — one signal, cleared by the void. Unlike the other three frameworks, solid-three wires `<Canvas>` handlers into the pointer system (see _Threads_, below), so a canvas handler carries `event.object` — `undefined` on a void. With Solid reactivity, that makes this the natural shape:

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

Here box B re-derives `selected() === "b"` reactively rather than being _told_ A was clicked. Selection is a positive click (with `stopPropagation`); deselection is the void clearing the signal — and the per-object "not-me" notification isn't needed.

The two shapes trade off:

- **decentralized** — scatters selection state across objects; every selectable object is checked on each click. Needs per-object "not-me".
- **centralized** — concentrates state in one signal and leans on the void. Needs only the void.

In a reactive renderer the centralized shape is cheap and idiomatic, which is what makes a void-only model (both fork proposals) viable. Whether per-object "not-me" is still worth keeping for the decentralized case is the open question below.

## Threads through this history

- **The silent flip is the cautionary tale.** #66 changed occlusion (per-type → union) and nothing noticed — the tests asserted _structure_ (which registry an object lands in), not _behaviour_ (does clicking an `onWheel` object still fire the miss). The exhaustive test pass should assert behaviour.
- **solid-three is the only one of the four with general canvas-level 3D handlers.** Its `<Canvas onClick>` (and every canvas pointer prop) is wired into the pointer system — a `context.props` callback fired after bubbling, carrying `event.object` (undefined on a void). r3f's and TresJS's `<Canvas onClick>` are plain DOM; Threlte has no canvas handler at all. That property is what makes #76's `event.object` model expressible — and it's unprecedented in the prior art.
- **Object override is opt-out only**, via a `raycastable={false}` prop (r3f's counterpart is `raycast={null}`) — like r3f, there's no way to opt a handler-less object _in_.
- **Event raycasting de-dups on targets, not results.** r3f raycasts each handler object's subtree separately, then de-dups the hits (`intersectObject(obj, true)` per root, then a `Set` of ids) — so overlapping subtrees are ray-tested more than once and the duplicates are thrown away _after_ the work is done. solid-three instead collects the registry into one de-duplicated set (`castRegistry`) and runs a single non-recursive pass, so each mesh is intersected once. Under deeply nested interactive hierarchies that avoids the repeated ray-vs-geometry work; on flat scenes (no overlapping handler subtrees) it's a wash. The saving is mechanical — not benchmarked here.

## Open questions

- _Occlusion: per-type vs union._ `#66` collapsed per-type into union; whether to restore per-type is open. And if per-type, a second question — what happens to a click that passes through a front object that doesn't handle it?

  ```jsx
  <Box position={front} onWheel={...} />   // front — handles wheel, not click
  <Box position={back} onClick={...} />    // directly behind it
  ```

  Click where they overlap. Per-type means the front box doesn't catch the click — but does the click then **block** (the front box still stops the ray, so the click counts as a void) or **pass through** (reach the back box's `onClick`)? The DOM is union with no pass-through.

- _Propagation._ Keep r3f-style z-depth tunnelling, or move to closest-hit-only like `@pmndrs/pointer-events`?
- _Override._ Stay opt-out-only (`raycastable`), or add a per-object `pointerEvents`-style control (pmndrs is the only prior art with one)?
- _Miss model._ Two open parts: (a) whether per-object "not-me" is worth supporting at all, or only the void; and (b) how the void is delivered — `event.object === undefined` on the ordinary canvas handler (#76) vs a dedicated `onVoid*` family (#75). The prior-art _convention_ for the void is a dedicated canvas handler (`onPointerMissed`, `@pointermissed`), which `onVoid*` matches; the `event.object` approach has no prior-art precedent.
