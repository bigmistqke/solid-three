# Deselection in solid-three

> A companion to [Pointer events in 3D](./pointer-events-in-3d.md) (the cross-framework design space) and [solid-three's pointer-event system: a chronology](./solid-three-event-system.md). It reuses their vocabulary — the void, `*Missed`, `event.object`.

Deselection — clicking empty space to clear a selection — is the one need the whole `*Missed` family exists to serve. There are two ways to build it in solid-three, and which one an app uses decides whether per-object **"not-me"** (a handler firing on every object the click _didn't_ land on) is needed at all.

## Contents

- [Decentralized — each object listens for its own miss](#decentralized--each-object-listens-for-its-own-miss)
- [Centralized — one signal, cleared by the void](#centralized--one-signal-cleared-by-the-void)
- [The tradeoff](#the-tradeoff)

## Decentralized — each object listens for its own miss

Each selectable object owns a boolean and listens for its own miss via `*Missed`:

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

## Centralized — one signal, cleared by the void

One signal, cleared by the void. solid-three wires `<Canvas>` handlers into the pointer system, so a canvas handler carries `event.object` — `undefined` on a void. With Solid reactivity, that makes this the natural shape:

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

## The tradeoff

- **decentralized** — scatters selection state across objects; every selectable object is checked on each click. Needs per-object "not-me".
- **centralized** — concentrates state in one signal and leans on the void. Needs only the void.

In a reactive renderer the centralized shape is cheap and idiomatic, which is what makes a void-only model viable. Whether per-object "not-me" is still worth keeping for the decentralized case is the [miss-model open question](./solid-three-event-system.md#open-questions) in the chronology.
