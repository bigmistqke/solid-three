# solid-three's pointer-event system: past, now, future

> Companion to [Pointer events in 3D](./pointer-events-in-3d.md), which maps the design space — occlusion, propagation, the miss — across the DOM, react-three-fiber, TresJS / `@pmndrs/pointer-events`, and Threlte. Read that first; this document reuses its vocabulary (the void, catch-all / pass-through, the r3f and pmndrs/tres camps) without re-deriving it — except _per-type vs union_, which is solid-three's own deviation and is defined below.

solid-three's pointer-event system was built the way most are: ported from react-three-fiber, then rewritten and re-rewritten — each time _without_ the design-space analysis the companion document lays out. That history is worth recording precisely, because the same forces are still in play: a fork is open right now that, like the refactor before it, settles a behaviour nobody is looking at.

This document is organised around that: the **open questions** the system still has to answer, then **past** (how it got here), **now** (what `next` does today, exactly), and **future** (the two open PRs, each run against the open questions). Commit hashes and dates are from the un-squashed history (`next-dirty`).

## Open questions

These are the axes a complete pointer-event system has to settle. The companion document names the first four as the design space; the last two are solid-three's own live decisions. The two open PRs touch only the last three — so the occlusion, propagation, and override questions are left open by everything currently on the table, and worth stating so they aren't mistaken for settled.

### Occlusion — per-type or union?

Which objects catch the pointer ray. The prior art is uniformly **union**: one handler of any kind makes an object hittable by _every_ gesture. solid-three was briefly **per-type** (hittable only for the gestures it handles — see Past); `#66` collapsed that back to union. Whether to restore per-type is open. And if per-type, a second question — what happens to a click that passes _through_ a front object that doesn't handle it:

```jsx
<Box position={front} onWheel={...} />   // front — handles wheel, not click
<Box position={back} onClick={...} />    // directly behind it
```

Click where they overlap. Per-type means the front box doesn't catch the click — but does the click then **block** (the front box still stops the ray, so the click counts as a void) or **pass through** (reach the back box's `onClick`)? The DOM is union with no pass-through.

### Propagation — z-depth tunnel or closest-hit?

Keep r3f-style z-depth tunnelling (every stacked hit fires, front-to-back, each bubbling its ancestors), or move to closest-hit-only like `@pmndrs/pointer-events` (only the nearest object, then its ancestors)? Both camps in the prior art are evenly split; today solid-three tunnels.

### Occlusion override — opt-out only, or a per-object control?

Stay opt-out-only (`raycastable={false}` makes a handler-bearing object pass-through, like r3f's `raycast={null}`), or add a per-object `pointerEvents`-style control that can also opt a handler-less object _in_ (pmndrs is the only prior art with one)?

### The participation rule for the void — union-by-listener or gesture-scoped?

When does a click "hit nothing"? This is **distinct from occlusion** — occlusion is which objects stop the ray; participation is which of those hits _suppress the void signal_. Two answers:

- **(a) union-by-listener** (the whole ecosystem): _any_ handler makes an object suppress the void. A click on a mesh whose only handler is `onWheel` is a hit, so it doesn't read as a void and click-to-deselect doesn't fire.
- **(b) gesture-scoped** (solid-three's instinct): only a handler _for that gesture_ suppresses the void — a click is a void unless an `onClick` ran somewhere in the hit's bubble chain. A click on that same `onWheel`-only mesh reads as a void, so click-to-deselect fires.

Both are defensible: (a) treats any interactive object as a real click target; (b) treats only click-handlers as relevant to a click. The ecosystem picks (a); solid-three has leaned (b). The point here is that it's a choice — not which way it should go.

This is the axis the two open PRs silently disagree on (see Future).

### The miss model — per-object "not-me", or only the void?

The miss has two levels (companion doc): **the void** (clicked empty space) and per-object **"not-me"** (clicked some _other_ object). solid-three is the only renderer with a true "not-me" — `onClickMissed` on a mesh fires when you click any _other_ object, via a complement set. Is that worth keeping, or does the void alone suffice? (In a reactive renderer the centralised "one signal, cleared by the void" shape makes "not-me" largely redundant — see [Deselection in solid-three](./deselection-in-solid-three.md).)

### Void delivery — a dedicated handler, or read it off the event?

How the void reaches code. The prior-art _convention_ is a dedicated canvas handler (`onPointerMissed`, `@pointermissed`). solid-three can express either: a dedicated `onVoid*` family (#75), or `event.object === undefined` on the ordinary canvas handler (#76). The latter has no prior-art precedent — it works only because solid-three wires `<Canvas>` handlers into the pointer system (see Threads).

## Reading the axes

Each stage below carries an **axes** table — where the codebase sat on the six questions at that point — with **bold** marking any axis that moved from the prior stage. Two movements carry the story. **Occlusion** reads union → per-type → union: the 2024 rewrite went per-type (a side effect of keying the registry by gesture), `#66` went back (a side effect of collapsing it) — neither flip a decision, neither caught by a test. **Propagation** never moves at all — tunnel + ancestor bubble since the r3f port, untouched by every rewrite and both PRs. And **Void participation** is where the open fork splits: #75 and #76 end on different values, even though the fork is discussed as a question of void delivery alone.

## One scene, three probes

Each stage also re-runs the **same scene**, re-spelled in that era's API and probed the same three ways. The setup never changes shape; watching its answers change (or hold steady) stage to stage is the point.

```jsx
<Canvas onMiss={clearSelection}>                // canvas-level deselect — spelling changes per era
  <Box onClick={select} onMiss={deselectA} />   // A — selectable, and listens for its own "not-me"
  <Box onWheel={scroll} />                        // B — only handles the wheel
  <Group onMiss={groupMissed}>                   // G — a geometry-less ancestor
    <Box onClick={e => e.stopPropagation()} />   // G's child — selects, and stops the bubble
  </Group>
</Canvas>
```

`onMiss` is a stand-in for whatever the era calls the miss (`onPointerMissed`, later `onClickMissed`, eventually nothing). The three probes:

- **Empty space** — click where no object is. _The void:_ does the canvas-level deselect fire, and does A hear its own miss?
- **Click B** — the wheel-only box. _Participation:_ does an unrelated handler count as a hit and block the deselect?
- **G's child** — the box inside the geometry-less group, which stops propagation. _Propagation × miss:_ does G's miss fire even though the click landed inside G?

Each probe carries two of the axes that actually move; propagation, which never moves, is deliberately not probed.

## Past

### 2023 — a 1:1 r3f port

solid-three began as a close port of r3f, and so did its event system: a single `interaction` array (**union** occlusion), `eventCount`, `onPointerMissed`, and r3f's **full** propagation — z-depth tunnel _and_ ancestor bubble. `onPointerMissed` arrived via PR #8 (`dd794de1`, 2023-05-22).

| Axis | 2023 — r3f port |
| --- | --- |
| Occlusion | `union` |
| Propagation | `tunnel + bubble` |
| Occlusion override | `none` |
| Void participation | `union` |
| Miss model | `void + not-me` |
| Void delivery | `onPointerMissed` |

```jsx
<Canvas onPointerMissed={clearSelection}>
  <Box onClick={select} onPointerMissed={deselectA} />   // A
  <Box onWheel={scroll} />                                 // B
  <Group onPointerMissed={groupMissed}>                   // G
    <Box onClick={e => e.stopPropagation()} />
  </Group>
</Canvas>
```

| Probe | canvas `onPointerMissed` | per-object miss |
| --- | --- | --- |
| Empty space | fires → clears | A fires |
| Click B | silent — union makes B a hit | A silent |
| G's child | silent — a hit | G silent |

r3f's per-object miss fires _only_ on a total miss, so a real hit — clicking B or G's child — triggers nothing. No Surprise B yet.

### 2024 — rebuilt from scratch: bubbling lost then restored, occlusion quietly per-type

In 2024 the event system was rebuilt from scratch (the flat `src/` layout). `cc02bab4` (2024-04-11) replaced it with a flat `src/events.ts` that had **no bubbling at all** and no `onPointerMissed`; `8d1acba3` ("add event-bubbling", 2024-04-15) added the ancestor walk back. So for a few days the event system had no propagation up the tree, then regained it.

The rewrite also changed occlusion — though no commit says so. Its `eventRegistry` was a dict keyed by event type: one object list per gesture (`eventRegistry.onClick`, `eventRegistry.onWheel`, …), and a click raycast only its own bucket (`intersectObjects(eventRegistry[type], true)`). An `onWheel`-only object was therefore never in the `onClick` bucket. That flipped occlusion from the **union** the 2023 port inherited from r3f to **per-type** — an emergent property of keying the registry by type, not a decision anyone recorded. The effect stayed invisible until `*Missed` arrived to expose it.

| Axis | 2024 — rewrite |
| --- | --- |
| Occlusion | **`per-type`** |
| Propagation | `tunnel + bubble` |
| Occlusion override | `none` |
| Void participation | **`via per-type`** |
| Miss model | **`none`** |
| Void delivery | **`—`** |

```jsx
<Canvas>                                     // no miss handler exists
  <Box onClick={select} />                   // A
  <Box onWheel={scroll} />                    // B
  <Group>
    <Box onClick={e => e.stopPropagation()} />
  </Group>
</Canvas>
```

- **All three probes are unanswerable.** The rewrite dropped the miss, so there is no deselect handler — canvas or per-object — to fire. The per-type bucketing exists (an `onWheel`-only box isn't in the click bucket), but with no miss to observe, you can't see it. The deselect feature simply doesn't exist this era.

### Aug 2025 — the `*Missed` era, the first deliberate redesign

A burst of same-day commits (2025-08-04) brought the miss back — and split it per gesture. `onPointerMissed` (dropped in the rewrite) returned as `onClickMissed` / `onDoubleClickMissed` / `onContextMenuMissed` (`80f579c6`, `7148625d`), each firing on every registered object a click _didn't_ land on — so a selectable object can hear "something else was clicked" and deselect itself (see [Deselection in solid-three](./deselection-in-solid-three.md)). Unlike r3f's miss, these respect `stopPropagation`. The same pass (`a0ffc80f`) regrouped the registries by behaviour (missable / movable / default) but kept them keyed per type. The override prop also lands here (a `pointerEvents` boolean, soon renamed `raycastable`).

Two things change at once: the miss returns at **both levels** — per-object "not-me" (the complement set) and a canvas total-miss — and per-type occlusion, in place silently since 2024, becomes _observable_ for the first time (the miss is what reveals it).

| Axis | Aug 2025 — `*Missed` |
| --- | --- |
| Occlusion | `per-type` |
| Propagation | `tunnel + bubble` |
| Occlusion override | **`raycastable`** (opt-out) |
| Void participation | `via per-type` |
| Miss model | **`void + not-me`** |
| Void delivery | **`*Missed`** |

```jsx
<Canvas onClickMissed={clearSelection}>
  <Box onClick={select} onClickMissed={deselectA} />   // A
  <Box onWheel={scroll} />                               // B
  <Group onClickMissed={groupMissed}>                   // G
    <Box onClick={e => e.stopPropagation()} />
  </Group>
</Canvas>
```

| Probe | canvas `onClickMissed` | per-object miss |
| --- | --- | --- |
| Empty space | fires → clears | A fires |
| Click B | **fires → clears** — per-type: B isn't in the click bucket | A fires |
| G's child | silent — a hit | **G fires — _Surprise B_** |

Click B flips to clearing — per-type: B sits only in the wheel bucket, so a click ray never tests it, and the click is a total miss. And _Surprise B_ appears. It falls out of what `*Missed` is taken to _mean_: not "the click didn't land on this object" (geometry) but "this object's handler wasn't called once the canvas event was handled" (delivery). Clicking G's child lands the ray _inside_ G, yet `stopPropagation` keeps G's own handler from running — so under the handler-based reading G "missed," and its `onClickMissed` fires. Mechanically: the bubble halts before G, so G is never crossed off the missed set, and the complement pass re-raycasts the leftovers but can't rescue a geometry-less ancestor. r3f never had this — its miss was total-miss-only; the complement set introduced it.

Was per-type _better_? Not clearly. Union's behaviour (a click on a visible `onWheel` box is a hit, so it doesn't deselect) is a defensible default; per-type lets clicks fall _through_ objects that don't handle them, which can surprise the other way. Per-type's one clear edge is performance: each gesture raycasts only its own, smaller bucket. Either way, nobody had decided it — and an undecided behaviour is an easily-lost one. The next stage is how.

### Jun 2026 — #66, the source-agnostic refactor (a silent occlusion flip)

`#66` (`c5db8e28`, 2026-06-05) rebuilt dispatch around a source-agnostic `Pointer` + `EventRaycaster` + `DOMPointerManager` (so XR controllers could feed the same system) and dropped the `onMouse*` aliases. As collateral, it **collapsed the per-gesture registries back into one** — every handler object went into a single `eventRegistry` again, regardless of gesture (`addEventListener(object, _type)` now ignores `_type`).

That flipped occlusion back to union. Changing occlusion wasn't the goal — the collapse served source-agnosticism, and the flip was a side effect. The point isn't that union is worse than per-type — it's that a whole axis of behaviour changed and **nothing noticed**. No test caught it: the suite pinned _which registry_ an object lands in (routing), not _what happens when you click_ (behaviour). Occlusion flipped invisibly, on a refactor that wasn't even about occlusion. (The fork in Future repeats this exact pattern on a different axis.)

| Axis | `#66` — now |
| --- | --- |
| Occlusion | **`union`** |
| Propagation | `tunnel + bubble` |
| Occlusion override | `raycastable` |
| Void participation | **`union`** (accidental) |
| Miss model | `void + not-me` |
| Void delivery | `*Missed` |

```jsx
<Canvas onClickMissed={clearSelection}>      // same code as Aug 2025
  <Box onClick={select} onClickMissed={deselectA} />   // A
  <Box onWheel={scroll} />                               // B
  <Group onClickMissed={groupMissed}>                   // G
    <Box onClick={e => e.stopPropagation()} />
  </Group>
</Canvas>
```

| Probe | canvas `onClickMissed` | per-object miss |
| --- | --- | --- |
| Empty space | fires → clears | A fires |
| Click B | **silent — union makes B a hit** | A fires |
| G's child | silent — a hit | G fires — _Surprise B_ |

Same code as Aug 2025, opposite result on _click B_: union makes B a hit, so the canvas miss stays silent (selection persists) — but A's own `onClickMissed` still fires (the complement set: A wasn't hit). The centralized deselect breaks; the decentralized one keeps working. Surprise B is unchanged.

### Jun 2026 — #69 / #72, capture and typing

Pointer capture + reactive `hasPointerCapture` + the `object` / `currentObject` event API (#69, `2f321abe`, 2026-06-07); a typed dispatched event replacing the `any` bag (#72, `0c61cbc0`, 2026-06-07). The `*Missed` handlers rode through both unchanged. This — union registry + `*Missed` — is what's merged on `next` today. The six axes, and all three probes, are unchanged from `#66`: capture and typing touch the dispatch plumbing, not any axis.

## Now — what `next` does today, exactly

The merged baseline, stated against the six open questions:

- **Occlusion — union.** One `eventRegistry`; any handler-bearing object is raycast for every gesture (`addEventListener(object, _type)` ignores `_type`, internal-context.ts). An `onWheel`-only mesh is tested by a click ray.
- **Propagation — z-depth tunnel + ancestor bubble** (r3f-shaped). The raycast yields all stacked hits nearest-first; each fires and bubbles up its parent chain. `stopPropagation` halts all farther entries — behind _and_ not-yet-fired ancestors. A node shared by several hits fires once (closest chain reaches it first).
- **Occlusion override — opt-out only.** `raycastable={false}` makes a handler-bearing object pass-through; there's no way to opt a handler-less one _in_.
- **Void participation — union-by-listener, by accident.** The canvas total-miss is `intersections.length === 0` over the flat registry — so any hit on any handler-bearing object suppresses the miss, regardless of gesture. This is option (a), and it falls out of the registry shape rather than a decision.
- **Miss model — both levels.** Per-object "not-me" (`onClickMissed` / `onDoubleClickMissed` / `onContextMenuMissed` on a mesh, firing on the complement set — every registered object the click didn't hit) _and_ a canvas-level total-miss (the same handlers on `<Canvas>`). Computed in `Pointer.click()` as three phases: bubble the hit chain, re-raycast the remaining registry to mark anything genuinely under the ray, then fire `*Missed` on the truly-missed set. These respect `stopPropagation`.
- **Void delivery — the `*Missed` handlers**, bundled per gesture under one name each (`onClickMissed` covers the click family's miss).

The three probes behave exactly as at `#66` above: empty space clears, clicking B leaves the selection set while A still hears its own miss, and G's child trips _Surprise B_.

Two structural notes carried from the companion threads: solid-three's `<Canvas onClick>` (and every canvas pointer prop) is a real 3D handler wired into the pointer system — fired after bubbling, carrying `event.object` (undefined on a void) — which no other renderer has. And event raycasting de-dups on targets, not results: the registry is collected into one de-duplicated set and run as a single non-recursive pass, so each mesh is intersected once (r3f raycasts each subtree then throws away duplicate hits).

## Future — the void fork (open)

Two **unmerged** branches (both 2026-06-08) propose replacing `*Missed` — _parallel proposals_, not a sequence. Both drop per-object "not-me" (the miss model becomes void-only) and move to a tres-shaped, void-only model. The doc has framed them as differing only in **void delivery** — _how you ask for the void_:

```jsx
// #75 (feat/void-events; d25e9e3d, b1671bcb) — a dedicated canvas handler per gesture
<Canvas onVoidClick={() => deselect()} />

// #76 (feat/void-via-event-object; dad769e) — the ordinary canvas handler; void = no object
<Canvas onClick={e => { if (!e.object) deselect() }} />
```

But reading the source shows they also disagree on **participation**, which those snippets hide. Both also reshape the probe scene the same way: dropping per-object "not-me" means A's self-miss and G's miss no longer exist, so only the canvas-level deselect survives — and with it go both _Surprise B_ (no per-object miss to mis-fire) and the decentralized deselect (A can no longer hear "something else was clicked").

### #75 — `onVoid*`, a dedicated canvas handler

A dedicated void handler per gesture (`onVoidClick`, `onVoidWheel`, …) on `<Canvas>`, fired when a gesture resolves to nothing.

| Axis | #75 (`onVoid*`) |
| --- | --- |
| Occlusion | `union` |
| Propagation | `tunnel + bubble` |
| Occlusion override | `raycastable` |
| Void participation | **`gesture-scoped`** |
| Miss model | **`void only`** |
| Void delivery | **`onVoid*`** |

```jsx
<Canvas onVoidClick={clearSelection}>
  <Box onClick={select} />                       // A — selectable (self-miss dropped)
  <Box onWheel={scroll} />                        // B — only handles the wheel
  <Group>                                         // G — miss handler dropped
    <Box onClick={e => e.stopPropagation()} />
  </Group>
</Canvas>
```

| Probe | canvas `onVoidClick` | per-object miss |
| --- | --- | --- |
| Empty space | fires → clears | n/a |
| Click B | **fires → clears** — gesture-scoped: no `onClick` in B's chain | n/a |
| G's child | silent — a real hit | n/a |

Dispatch tracks `firedOnObject`, set true only when a handler _for the dispatched gesture_ runs somewhere in a hit's bubble chain (`propagate` returns it; `finishVoidable` fires `onVoid<Kind>` only when it's false). Clicking B finds no `onClick` in its chain → `firedOnObject` stays false → `onVoidClick` fires. This is **gesture-scoped (option b)**, on purpose — the tests assert it ("gesture-scoped parity, chain-aware"): a click on the wheel-only box reads as a void. The channel is **exclusive**: `onClick` ("a real click was handled") and `onVoidClick` ("none was") never both fire.

### #76 — `event.object`, read off the canvas handler

No new handler: the ordinary canvas `onClick` (and every canvas pointer prop) fires on every gesture, with `event.object` set to the hit or `undefined` on a void — so `if (!e.object)` is the empty-space test.

| Axis | #76 (`event.object`) |
| --- | --- |
| Occlusion | `union` |
| Propagation | `tunnel + bubble` |
| Occlusion override | `raycastable` |
| Void participation | `union` |
| Miss model | **`void only`** |
| Void delivery | **`event.object`** |

```jsx
<Canvas onClick={e => { if (!e.object) clearSelection() }}>
  <Box onClick={select} />                       // A — selectable (self-miss dropped)
  <Box onWheel={scroll} />                        // B — only handles the wheel
  <Group>                                         // G — miss handler dropped
    <Box onClick={e => e.stopPropagation()} />
  </Group>
</Canvas>
```

| Probe | canvas `onClick` | per-object miss |
| --- | --- | --- |
| Empty space | `e.object` undefined → clears | n/a |
| Click B | `e.object` is B → stays selected | n/a |
| G's child | `e.object` set → not a void → nothing | n/a |

`click()` routes through the shared `propagate()`, which always fires the canvas handler with `event.object = intersections[0]?.object`. Clicking B is a hit, so `event.object` is B — not `undefined` — so the guard is false. This is **union-by-listener (option a)**, arrived at _incidentally_ (it's just what reading `intersections[0]` gives you): a click on the wheel-only box stays a hit, not a void. The channel is **one**: `onClick` fires on both hit and void, and you branch on `event.object` inside the single handler, which runs on every click and must guard.

### The hidden fork: participation

Line the two probe tables up and only one row differs — **click B**: #75 clears, #76 stays selected. The PRs are sold as a choice of _void delivery_ (`onVoid*` vs `event.object`), but that one row is them answering the _participation_ question opposite ways — #75 gesture-scoped, #76 union — and nothing in the delivery framing surfaces it. This is the #66 pattern again: a behavioural axis (participation) riding along on a refactor whose stated subject is something else (delivery). It should be decided on its own merits, not inherited from whichever delivery shape wins.

#75's `onVoid*` family matches the prior-art convention (a dedicated canvas miss handler); #76's `event.object` reading has no precedent — it works only because solid-three wires `<Canvas>` handlers into the pointer system.

### What the fork leaves open

Neither PR changes occlusion, propagation, or override. In particular, neither brings back the per-type occlusion that #66 dropped: under both, an `onWheel` object still catches a click ray, exactly as it does on `next`. What #75 changes is narrower — whether that catch _counts as a hit that suppresses the void_, not whether the ray stops at the object. So #75 recovers the deselect behaviour per-type used to give (a click on a wheel-only box still clears the selection) without actually restoring per-type occlusion. Everything else stays open whichever PR lands: whether to make occlusion per-type again, whether to trade z-depth tunnelling for closest-hit, and whether to add a per-object override.

## Threads through this history

- **The silent flip is the cautionary tale — and it recurs.** #66 changed occlusion (per-type → union) and nothing noticed, because the tests asserted _structure_ (which registry an object lands in), not _behaviour_. The open fork repeats it on void participation: #75 and #76 quietly disagree on it while the discussion is about void delivery. The exhaustive test pass should assert behaviour, and the fork should be decided on participation explicitly, not as a side effect of the delivery choice. Concretely it is one click with shifting answers: clicking the wheel-only box clears the selection in Aug 2025 and under #75, but not in 2023, on `next`, or under #76 — the same gesture, opposite outcomes, none of them deliberately chosen.
- **solid-three is the only one of the four with general canvas-level 3D handlers.** Its `<Canvas onClick>` (and every canvas pointer prop) is wired into the pointer system — a `context.props` callback fired after bubbling, carrying `event.object` (undefined on a void). r3f's and TresJS's `<Canvas onClick>` are plain DOM; Threlte has no canvas handler at all. That property is what makes #76's `event.object` model expressible — and it's unprecedented in the prior art.
- **Object override is opt-out only**, via a `raycastable={false}` prop (r3f's counterpart is `raycast={null}`) — like r3f, there's no way to opt a handler-less object _in_.
- **Event raycasting de-dups on targets, not results.** r3f raycasts each handler object's subtree separately, then de-dups the hits — so overlapping subtrees are ray-tested more than once and the duplicates are thrown away _after_ the work is done. solid-three instead collects the registry into one de-duplicated set (`castRegistry`) and runs a single non-recursive pass, so each mesh is intersected once. Under deeply nested interactive hierarchies that avoids the repeated ray-vs-geometry work; on flat scenes it's a wash. The saving is mechanical — not benchmarked here.
