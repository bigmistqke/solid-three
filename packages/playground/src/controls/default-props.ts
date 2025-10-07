import type { MergeProps } from "solid-js"
import { mergeProps } from "solid-js"
import type { KeyOfOptionals } from "./type-utils"

export function defaultProps<TProps, TKeys extends KeyOfOptionals<TProps>>(
  props: TProps,
  defaults: Required<Pick<TProps, TKeys>>,
): MergeProps<[Required<Pick<TProps, TKeys>>, TProps]> {
  return mergeProps(defaults, props)
}
