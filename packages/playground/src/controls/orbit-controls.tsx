import { whenEffect } from "@bigmistqke/solid-whenever"
import { createEffect, createMemo, onCleanup, type Ref } from "solid-js"
import {
  useFrame,
  useProps,
  useThree,
  type CameraKind,
  type Props,
  type Vector3,
} from "solid-three"
import type { Event } from "three"
import { OrbitControls as ThreeOrbitControls } from "three-stdlib"
import { processProps } from "./process-props.ts"

export interface OrbitControlsProps extends Props<typeof ThreeOrbitControls> {
  ref?: Ref<ThreeOrbitControls>
  camera?: CameraKind
  domElement?: HTMLElement
  enableDamping?: boolean
  onChange?: (e?: Event<"change", ThreeOrbitControls>) => void
  onEnd?: (e?: Event<"end", ThreeOrbitControls>) => void
  onStart?: (e?: Event<"start", ThreeOrbitControls>) => void
  regress?: boolean
  target?: Vector3
  keyEvents?: boolean | HTMLElement
}

export function OrbitControls(props: OrbitControlsProps) {
  const [config, rest] = processProps(
    props,
    {
      enableDamping: true,
      keyEvents: false,
    },
    [
      "camera",
      "regress",
      "domElement",
      "keyEvents",
      "onChange",
      "onStart",
      "onEnd",
      "object",
      "dispose",
    ],
  )
  const three = useThree()
  const controls = createMemo<ThreeOrbitControls>(previous => {
    previous?.dispose()
    return new ThreeOrbitControls(config.camera ?? three.camera)
  })

  useFrame(() => controls().update())

  whenEffect(controls, controls => controls.connect(props.domElement ?? three.gl.domElement))

  createEffect(() => {
    const callback = config.onStart
    if (!callback) return
    const _controls = controls()
    _controls.addEventListener("start", callback)
    onCleanup(() => _controls.removeEventListener("start", callback))
  })
  createEffect(() => {
    const callback = config.onChange
    if (!callback) return
    const _controls = controls()
    _controls.addEventListener("change", callback)
    onCleanup(() => _controls.removeEventListener("change", callback))
  })
  createEffect(() => {
    const callback = config.onEnd
    if (!callback) return
    const _controls = controls()
    _controls.addEventListener("end", callback)
    onCleanup(() => _controls.removeEventListener("end", callback))
  })

  useProps(controls, rest)

  return null!
}
