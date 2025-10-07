import { createContext, useContext, type JSX } from "solid-js"
import type { Context } from "../types.ts"

export type TestContextType = {
  three: Context | null
  setThree: (three: Context) => void
}

const TestContext = createContext<TestContextType>()

export function TestProvider(props: { 
  children: JSX.Element
  onThreeReady?: (three: Context) => void 
}) {
  let three: Context | null = null

  const setThree = (context: Context) => {
    three = context
    props.onThreeReady?.(context)
  }

  return (
    <TestContext.Provider value={{ three, setThree }}>
      {props.children}
    </TestContext.Provider>
  )
}

export function useTestContext() {
  const context = useContext(TestContext)
  if (!context) {
    throw new Error("useTestContext must be used within TestProvider")
  }
  return context
}

// Function to check if we're in a test environment
export function isTestEnvironment() {
  const context = useContext(TestContext)
  return !!context
}