# solid-three's pointer-event system: a chronology

> Companion to [Pointer events in 3D](./pointer-events-in-3d.md), which maps the design space — occlusion, propagation, the miss — across the DOM, react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte. Read that first; this document reuses its vocabulary (the void, catch-all / pass-through, the r3f / tres poles) without re-deriving it — except _per-type vs union_, which is solid-three's own deviation and is defined below.

solid-three's pointer-event system was built the way most are: ported from react-three-fiber, then rewritten and re-rewritten — each time _without_ the design-space analysis the companion document lays out. This chronology records what the semantics actually _were_ at each stage, and the behaviour that _emerged_ from those rebuilds: some of it chosen deliberately, some of it not — most starkly, a regression nobody intended. It is the case study for why mapping the space first is worth doing.

Branch names that recur: `main` = the original/legacy port; `next` = the current development line; `next-dirty` = `next`'s un-squashed history. All receipts are commit hashes and dates from `next-dirty`.

## 2023 — a 1:1 r3f port

solid-three began as a close port of r3f, down to the `solid-zustand` store: the `interaction` array, `eventCount`, `onPointerMissed`, and r3f's **full** propagation — z-depth tunnel _and_ ancestor bubble (`src/core/events.ts` carries r3f's bubble loop verbatim). `onPointerMissed` arrived via `vorth/pointer-missed` (PR #8, merge `dd794de1`, 2023-05-22; closes issue **#7**), with a follow-up bugfix that December. The later zustand → `solid-js/store` migration (`f8bc3716`, 2023-07-16) left the bubbling untouched. (This port still lives on `main`.)

## 2024 — a from-scratch rewrite re-adds bubbling

The current solid-three does **not** descend from that port; it descends from a separate, from-scratch rewrite (the flat `src/` layout, no `zustand`) that branched off at the PR #8 merge (`dd794de1`) and re-implemented events. `cc02bab4` (2024-04-11) deleted `src/core/events.ts` and added a flat `src/events.ts` with **no bubbling at all**; `8d1acba3` ("add event-bubbling", 2024-04-15) added the ancestor walk back — re-establishing what the original port had had all along, not introducing anything new. The two lines are genuinely parallel: `git merge-base` confirms the port tip is _not_ an ancestor of the rewrite, and `next` descends from the rewrite, not the port.

## Aug 2025 — the `*Missed` era, the first deliberate redesign

A burst of same-day commits (2025-08-04) split the single `onPointerMissed` into per-gesture `onClickMissed` / `onDoubleClickMissed` / `onContextMenuMissed` (`80f579c6`, `7148625d`), computed as a _complement set_ — fire on every registered object the ray did _not_ hit, occlusion-correct and `stopPropagation`-aware. The same pass (`a0ffc80f`) introduced **per-category registries** (separate missable / hover / default registries, routed by handler type) — and with them the one place solid-three diverged from every other framework on _occlusion_. Everywhere else is **union**: any single handler makes an object catch _every_ gesture (a box with only `onWheel` is a catch-all for `click` too — a click ray still hits it). The per-category registries instead made an object catch only the gestures it actually handled — **per-type**: an `onWheel`-only object lived in the wheel registry, not the click registry, so clicking it did _not_ suppress the click-miss.

## Jun 2026 — #66, the source-agnostic refactor (the regression)

`#66` (`c5db8e28`, 2026-06-05) rebuilt dispatch around a source-agnostic `Pointer` + `EventRaycaster` + `DOMPointerManager` (so XR controllers could feed the same system) and dropped the `onMouse*` aliases — and, as collateral, **collapsed the per-category registries into one union `eventRegistry`** (`addEventListener(object, _type)` now ignores `_type`). Changing occlusion semantics wasn't the goal; the collapse served source-agnosticism. But it flipped per-type → union, reintroducing the `onWheel`-suppresses-click-miss asymmetry the per-category design had avoided. No test caught it — the suite pinned registry _routing_, not observable behaviour. This is the **emergent regression**: a behaviour change nobody chose, invisible because nothing tested behaviour.

## Jun 2026 — #69 / #72, capture and typing

Pointer capture + reactive `hasPointerCapture` + the `object` / `currentObject` event API (#69, `2f321abe`, 2026-06-07); a typed dispatched event replacing the `any` bag (#72, `0c61cbc0`, 2026-06-07). The `*Missed` complement-set rode through both unchanged. This — union registry + `*Missed` — is what's merged on `next` today.

## Jun 2026 — the void fork (open)

Two branches replace `*Missed` — both 2026-06-08, both forking off `5e7875f`, both **unmerged**. They are _parallel proposals_, not a sequence: `git merge-base --is-ancestor` confirms neither is an ancestor of the other. Both move solid-three off the r3f-shaped `*Missed` (per-object complement, both levels) toward a tres-shaped, void-only model:

- **#75 `onVoid*`** (`feat/void-events`; `d25e9e3d`, `b1671bcb`): drop `*Missed` for a dedicated `onVoid*` canvas family (`onVoidClick`, `onVoidPointerDown`, …) — a per-gesture void handler, matching the prior-art convention of a dedicated canvas miss handler.
- **#76 `event.object`** (`feat/void-via-event-object`; `dad769e`): drop `*Missed` and detect the void by reading `event.object` (undefined) on the ordinary canvas-level handler — the "general canvas handler carries `event.object`" model.

The open question is which void _representation_ wins. Neither restores the per-type occlusion that #66 dropped, so on the merged baseline and both proposals the `onWheel` asymmetry still stands.

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

**Centralized** — one signal, cleared by the void. solid-three's `event.object` (undefined on a void) plus Solid reactivity make this the natural shape:

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

- **The regression is the cautionary tale.** #66's per-type → union flip was invisible because the tests asserted _structure_ (which registry an object lands in), not _behaviour_ (does clicking an `onWheel` object suppress the miss). The exhaustive test pass should assert behaviour.
- **solid-three is the only one of the four with general canvas-level 3D handlers.** Its `<Canvas onClick>` (and every canvas pointer prop) is wired into the pointer system — a `context.props` callback fired after bubbling, carrying `event.object` (undefined on a void). r3f's and TresJS's `<Canvas onClick>` are plain DOM; Threlte has no canvas handler at all. That property is what makes #76's `event.object` model expressible — and it's unprecedented in the prior art.
- **Object override is opt-out only**, via `raycastable={false}` — like r3f, there's no way to opt a handler-less object _in_.

## Open questions

- _Occlusion: per-type vs union._ `#66` collapsed per-type into union. Whether to restore per-type is open — and if per-type, whether a front object that doesn't handle the gesture should **block** (no fall-through, count as a void) or be **pass-through** (fall-through to whatever's behind). (The DOM is union-occlusion with no fall-through.)
- _Propagation._ Keep r3f-style z-depth tunnelling, or move to closest-hit-only like `@pmndrs/pointer-events`?
- _Override._ Stay opt-out-only (`raycastable`), or add a per-object `pointerEvents`-style control (pmndrs is the only prior art with one)?
- _Miss model._ Two open parts: (a) whether per-object "not-me" is worth supporting at all, or only the void; and (b) how the void is delivered — `event.object === undefined` on the ordinary canvas handler (#76) vs a dedicated `onVoid*` family (#75). The prior-art _convention_ for the void is a dedicated canvas handler (`onPointerMissed`, `@pointermissed`), which `onVoid*` matches; the `event.object` approach has no prior-art precedent.
