/**
 * Utility to check if code is running in a browser environment
 * @returns true if running in browser, false if in Node.js or other non-browser environment
 */
export function inBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

/**
 * Utility to check if code is running in a Node.js environment
 * @returns true if running in Node.js, false if in browser
 */
export function inNode(): boolean {
  return !inBrowser()
}