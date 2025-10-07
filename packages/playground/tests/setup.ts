import { vi } from 'vitest'

// Mock ResizeObserver for test environment
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn().mockImplementation((cb: FrameRequestCallback) => {
  return setTimeout(() => cb(Date.now()), 16)
})

global.cancelAnimationFrame = vi.fn().mockImplementation((id: number) => {
  clearTimeout(id)
})