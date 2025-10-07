import { splitProps } from "solid-js"
import { defaultProps } from "./default-props.ts"
import type { KeyOfOptionals } from "./type-utils.ts"

export function processProps<
  const TProps,
  const TDefaults extends Required<Pick<TProps, KeyOfOptionals<TProps>>>,
  const TSplit extends readonly (keyof TProps)[],
>(props: TProps, defaults: TDefaults, split?: TSplit) {
  return splitProps(defaultProps(props, defaults), split ?? [])
}
