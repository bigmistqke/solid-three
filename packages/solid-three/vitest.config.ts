import { defineConfig } from "vitest/config"
import solid from "vite-plugin-solid"
import tsconfig from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [tsconfig(), solid({ ssr: false })],
  test: {
    globals: true,
    environment: "jsdom",
    testTimeout: 5000,
    transformMode: {
      web: [/\.tsx?$/],
      ssr: [],
    },
    setupFiles: ['./tests/setup.ts'],
  },
  esbuild: {
    target: "esnext",
  },
  ssr: {
    noExternal: ['solid-js', 'solid-js/web'],
  },
})