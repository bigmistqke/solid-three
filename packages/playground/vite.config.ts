import { defineConfig } from "vite"
import inspect from "vite-plugin-inspect"
import solid from "vite-plugin-solid"
import tsconfig from "vite-tsconfig-paths"

export default defineConfig({
  base: "./",
  plugins: [tsconfig(), solid(), inspect()],
})
