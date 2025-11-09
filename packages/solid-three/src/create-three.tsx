import {
  children,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  mergeProps,
  onCleanup,
} from "solid-js"
import {
  ACESFilmicToneMapping,
  BasicShadowMap,
  Camera,
  Clock,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from "three"
import type { CanvasProps } from "./canvas.tsx"
import { createEvents } from "./create-events.ts"
import { Stack } from "./data-structure/stack.ts"
import { frameContext, threeContext } from "./hooks.ts"
import { eventContext } from "./internal-context.ts"
import { useProps, useSceneGraph } from "./props.ts"
import { CursorRaycaster, type EventRaycaster } from "./raycasters.tsx"
import type { CameraKind, Context, FrameListener, FrameListenerCallback } from "./types.ts"
import {
  binarySearch,
  defaultProps,
  getCurrentViewport,
  meta,
  removeElementFromArray,
  updateCameraAspect,
  useRef,
  withMultiContexts,
} from "./utils.ts"
import { useMeasure } from "./utils/use-measure.ts"

/**
 * Creates and manages a `solid-three` scene. It initializes necessary objects like
 * camera, renderer, raycaster, and scene, manages the scene graph, setups up an event system
 * and rendering loop based on the provided properties.
 */
export function createThree(canvas: HTMLCanvasElement, props: CanvasProps) {
  const canvasProps = defaultProps(props, { frameloop: "always" })

  /**********************************************************************************/
  /*                                                                                */
  /*                                 Frame Listeners                                */
  /*                                                                                */
  /**********************************************************************************/

  const frameListeners = {
    before: {
      map: new Map<number, FrameListenerCallback[]>(),
      priorities: [] as number[], // Keep this sorted
    },
    after: {
      map: new Map<number, FrameListenerCallback[]>(),
      priorities: [] as number[],
    },
  }

  const addFrameListener: FrameListener = (callback, options) => {
    return createRoot(dispose => {
      createRenderEffect(() => {
        const { stage = "before", priority = 0 } = options ?? {}

        const listeners = frameListeners[stage]

        let array = listeners.map.get(priority)

        if (!array) {
          array = []
          listeners.map.set(priority, array)
          const index = binarySearch(listeners.priorities, priority)
          listeners.priorities.splice(index, 0, priority)
        }

        array.push(callback)

        onCleanup(() => {
          removeElementFromArray(array, callback)
          if (array.length === 0) {
            listeners.map.delete(priority)
            listeners.priorities.splice(listeners.priorities.indexOf(priority), 1)
          }
        })
      })

      return dispose
    })
  }

  function updateFrameListeners(stage: "before" | "after", delta: number, frame?: XRFrame) {
    for (const priority of frameListeners[stage].priorities) {
      const callbacks = frameListeners[stage].map.get(priority)!
      for (const callback of callbacks) {
        callback(context, delta, frame)
      }
    }
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                                        XR                                      */
  /*                                                                                */
  /**********************************************************************************/

  // Handle frame behavior in WebXR
  const handleXRFrame: XRFrameRequestCallback = (timestamp: number, frame?: XRFrame) => {
    if (canvasProps.frameloop === "never") return
    render(timestamp, frame)
  }
  // Toggle render switching on session
  function handleSessionChange() {
    context.gl.xr.enabled = context.gl.xr.isPresenting
    context.gl.xr.setAnimationLoop(context.gl.xr.isPresenting ? handleXRFrame : null)
  }
  // WebXR session-manager
  const xr = {
    connect() {
      context.gl.xr.addEventListener("sessionstart", handleSessionChange)
      context.gl.xr.addEventListener("sessionend", handleSessionChange)
    },
    disconnect() {
      context.gl.xr.removeEventListener("sessionstart", handleSessionChange)
      context.gl.xr.removeEventListener("sessionend", handleSessionChange)
    },
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                                     Render                                     */
  /*                                                                                */
  /**********************************************************************************/

  let pendingRenderRequest: number | undefined

  function render(timestamp: number, frame?: XRFrame) {
    if (!context.gl) {
      return
    }
    if (props.frameloop === "never") {
      context.clock.elapsedTime = timestamp
    }
    pendingRenderRequest = undefined

    const delta = context.clock.getDelta()
    updateFrameListeners("before", delta, frame)
    context.gl.render(context.scene, context.camera)
    updateFrameListeners("after", delta, frame)
  }
  function requestRender() {
    if (pendingRenderRequest) return
    pendingRenderRequest = requestAnimationFrame(render)
  }
  onCleanup(() => pendingRenderRequest && cancelAnimationFrame(pendingRenderRequest))

  /**********************************************************************************/
  /*                                                                                */
  /*                                  Three Context                                 */
  /*                                                                                */
  /**********************************************************************************/

  const defaultCamera = createMemo(() =>
    meta(
      props.camera instanceof Camera
        ? (props.camera as OrthographicCamera | PerspectiveCamera)
        : props.orthographic
        ? new OrthographicCamera(...(props.camera?.args ?? []))
        : // @ts-expect-error
          new PerspectiveCamera(...(props.camera?.args ?? [])),
      {
        get props() {
          return props.camera || {}
        },
      },
    ),
  )
  const cameraStack = new Stack<CameraKind>("camera")

  const scene = createMemo(() =>
    meta(props.scene instanceof Scene ? props.scene : new Scene(), {
      get props() {
        return props.scene || {}
      },
    }),
  )

  const defaultRaycaster = createMemo(() =>
    meta<Raycaster | EventRaycaster>(
      props.raycaster instanceof Raycaster
        ? props.raycaster
        : new CursorRaycaster(...(props.raycaster?.args ?? [])),
      {
        get props() {
          return props.raycaster || {}
        },
      },
    ),
  )

  const raycasterStack = new Stack<Raycaster>("raycaster")

  const gl = createMemo(() => {
    const gl =
      props.gl instanceof WebGLRenderer
        ? props.gl
        : typeof props.gl === "function"
        ? props.gl(canvas)
        : new WebGLRenderer({
            canvas,
            powerPreference: "high-performance",
            antialias: true,
            alpha: true,
            ...props.gl?.args?.[0],
          })

    return meta(gl, {
      get props() {
        return props.gl || {}
      },
    })
  })

  const measure = useMeasure()
  measure.setElement(canvas.parentElement)

  const defaultTarget = new Vector3()
  const viewport = createMemo(() =>
    getCurrentViewport(defaultCamera(), defaultTarget, measure.bounds()),
  )

  const clock = new Clock()
  clock.start()

  const context: Context = {
    get bounds() {
      return measure.bounds()
    },
    canvas,
    clock,
    get dpr() {
      return this.gl.getPixelRatio()
    },
    props,
    render,
    requestRender,
    get viewport() {
      return viewport()
    },
    xr,
    // elements
    get camera() {
      return cameraStack.peek() ?? defaultCamera()
    },
    setCamera(camera: CameraKind) {
      return cameraStack.push(camera)
    },
    get scene() {
      return scene()
    },
    get raycaster() {
      return raycasterStack.peek() || defaultRaycaster()
    },
    setRaycaster(raycaster: Raycaster) {
      return raycasterStack.push(raycaster)
    },
    get gl() {
      return gl()
    },
  }

  withMultiContexts(
    () => useRef(props, context),
    [
      [threeContext, context],
      [frameContext, addFrameListener],
    ],
  )

  /**********************************************************************************/
  /*                                                                                */
  /*                                  Side-Effects                                  */
  /*                                                                                */
  /**********************************************************************************/

  withMultiContexts(() => {
    createRenderEffect(() => {
      if (props.frameloop === "never") {
        context.clock.stop()
        context.clock.elapsedTime = 0
      } else {
        context.clock.start()
      }
    })

    /* Default Camera Side-Effects */
    createRenderEffect(() => {
      if (cameraStack.peek()) return
      if (!props.camera || props.camera instanceof Camera) return
      useProps(defaultCamera, props.camera)
      // NOTE:  Manually update camera's matrix with updateMatrixWorld is needed.
      //        Otherwise casting a ray immediately after start-up will cause the incorrect matrix to be used.
      defaultCamera().updateMatrixWorld(true)
    })

    /* Scene Side-Effects */
    createRenderEffect(() => {
      if (!props.scene || props.scene instanceof Scene) return
      useProps(scene, props.scene)
    })

    /* Raycaster Side-Effects */
    createRenderEffect(() => {
      if (!props.raycaster || props.raycaster instanceof Raycaster) return
      useProps(defaultRaycaster, props.raycaster)
    })

    /* Gl Side-Effects */
    createRenderEffect(() => {
      // Set shadow-map
      createRenderEffect(() => {
        const _gl = gl()
        if (_gl.shadowMap) {
          const oldEnabled = _gl.shadowMap.enabled
          const oldType = _gl.shadowMap.type
          _gl.shadowMap.enabled = !!props.shadows

          if (typeof props.shadows === "boolean") {
            _gl.shadowMap.type = PCFSoftShadowMap
          } else if (typeof props.shadows === "string") {
            const types = {
              basic: BasicShadowMap,
              percentage: PCFShadowMap,
              soft: PCFSoftShadowMap,
              variance: VSMShadowMap,
            }
            _gl.shadowMap.type = types[props.shadows] ?? PCFSoftShadowMap
          } else if (typeof props.shadows === "object") {
            Object.assign(_gl.shadowMap, props.shadows)
          }

          if (oldEnabled !== _gl.shadowMap.enabled || oldType !== _gl.shadowMap.type)
            _gl.shadowMap.needsUpdate = true
        }
      })

      createEffect(() => {
        const renderer = gl()
        // Connect to xr if property exists
        if (renderer.xr) context.xr.connect()
      })

      // Set color space and tonemapping preferences
      const LinearEncoding = 3000
      const sRGBEncoding = 3001

      // Color management and tone-mapping
      useProps(gl, {
        get outputEncoding() {
          return props.linear ? LinearEncoding : sRGBEncoding
        },
        get toneMapping() {
          return props.flat ? NoToneMapping : ACESFilmicToneMapping
        },
      })

      // Manage props
      if (props.gl && !(props.gl instanceof WebGLRenderer)) {
        useProps(gl, props.gl)
      }
    })

    /* Bounds Side-Effects: Handle aspect ratio of WebGLRenderer and the current camera */
    createRenderEffect(() => {
      const bounds = measure.bounds()
      context.gl.setSize(bounds.width, bounds.height)
      context.gl.setPixelRatio(globalThis.devicePixelRatio)
      createRenderEffect(() => updateCameraAspect(context.camera, bounds))
      context.render(performance.now())
    })
  }, [[threeContext, context]])

  /**********************************************************************************/
  /*                                                                                */
  /*                                   Render Loop                                  */
  /*                                                                                */
  /**********************************************************************************/

  let pendingLoopRequest: number | undefined
  function loop(value: number) {
    if (typeof requestAnimationFrame !== "undefined") {
      pendingLoopRequest = requestAnimationFrame(loop)
    }
    context.render(value)
  }
  createRenderEffect(() => {
    if (canvasProps.frameloop === "always" && typeof requestAnimationFrame !== "undefined") {
      pendingLoopRequest = requestAnimationFrame(loop)
    }
    onCleanup(() => {
      if (pendingLoopRequest && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(pendingLoopRequest)
      }
    })
  })

  /**********************************************************************************/
  /*                                                                                */
  /*                                     Events                                     */
  /*                                                                                */
  /**********************************************************************************/

  // Initialize event-system
  const { addEventListener } = createEvents(context)

  /**********************************************************************************/
  /*                                                                                */
  /*                                   Scene Graph                                  */
  /*                                                                                */
  /**********************************************************************************/

  const c = children(() => (
    <eventContext.Provider value={addEventListener}>
      <frameContext.Provider value={addFrameListener}>
        <threeContext.Provider value={context}>{canvasProps.children}</threeContext.Provider>
      </frameContext.Provider>
    </eventContext.Provider>
  ))

  useSceneGraph(
    context.scene,
    mergeProps(props, {
      get children() {
        return c()
      },
    }),
  )

  // Return context merged with `addFrameListeners``
  // This is used in `@solid-three/testing`
  return mergeProps(context, { addFrameListener })
}
