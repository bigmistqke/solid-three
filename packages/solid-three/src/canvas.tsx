import { onMount, type JSX, type ParentProps, type Ref } from "solid-js"
import {
  Camera,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  WebGLRenderer,
} from "three"
import { createThree } from "./create-three.tsx"
import type { EventRaycaster } from "./raycasters.tsx"
import { TestCanvas } from "./testing/index.tsx"
import { isTestEnvironment, useTestContext } from "./testing/test-provider.tsx"
import type { CanvasEventHandlers, Context, Props } from "./types.ts"
import { inBrowser } from "./utils/in-browser.ts"

/**
 * Props for the Canvas component, which initializes the Three.js rendering context and acts as the root for your 3D scene.
 */
export interface CanvasProps extends ParentProps<Partial<CanvasEventHandlers>> {
  ref?: Ref<Context>
  class?: string
  /** Configuration for the camera used in the scene. */
  camera?: Partial<Props<typeof PerspectiveCamera> | Props<typeof OrthographicCamera>> | Camera
  /** Element to render while the main content is loading asynchronously.  */
  fallback?: JSX.Element
  /** Toggles flat interpolation for texture filtering. */
  flat?: boolean
  /** Controls the rendering loop's operation mode. */
  frameloop?: "never" | "demand" | "always"
  /** Options for the WebGLRenderer or a function returning a customized renderer. */
  gl?:
    | Partial<Props<typeof WebGLRenderer>>
    | ((canvas: HTMLCanvasElement) => WebGLRenderer)
    | WebGLRenderer
  /** Toggles linear interpolation for texture filtering. */
  linear?: boolean
  /** Toggles between Orthographic and Perspective camera. */
  orthographic?: boolean
  /** Configuration for the Raycaster used for mouse and pointer events. */
  raycaster?: Partial<Props<typeof Raycaster>> | EventRaycaster | Raycaster
  /** Configuration for the Scene instance. */
  scene?: Partial<Props<typeof Scene>> | Scene
  /** Enables and configures shadows in the scene. */
  shadows?: boolean | "basic" | "percentage" | "soft" | "variance" | WebGLRenderer["shadowMap"]
  /** Custom CSS styles for the canvas container. */
  style?: JSX.CSSProperties
}

/**
 * Serves as the root component for all 3D scenes created with `solid-three`. It initializes
 * the Three.js rendering context, including a WebGL renderer, a scene, and a camera.
 * All `<T/>`-components must be children of this Canvas. Hooks such as `useThree` and
 * `useFrame` should only be used within this component to ensure proper context.
 *
 * @function Canvas
 * @param props - Configuration options include camera settings, style, and children elements.
 * @returns A div element containing the WebGL canvas configured to occupy the full available space.
 */
export function Canvas(props: ParentProps<CanvasProps>) {
  // If we're not in a browser environment (e.g., Node.js), use TestCanvas instead
  if (!inBrowser()) {
    return <TestCanvas {...props} />
  }
  let canvas: HTMLCanvasElement = null!
  let container: HTMLDivElement = null!

  onMount(() => {
    const context = createThree(canvas, props)
    // If we're in a test environment, pass the context to the TestProvider
    if (isTestEnvironment()) {
      const testContext = useTestContext()
      testContext.setThree(context)
    }
  })

  return (
    <div
      ref={container!}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        contain: "strict",
        display: "flex",
        ...props.style,
      }}
      class={props.class}
    >
      <canvas ref={canvas!} />
    </div>
  )
}
