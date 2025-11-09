import { type Accessor, type Setter, createSignal, getOwner, onCleanup } from "solid-js"

/** Class representing a stack data structure. */
export class Stack<T = any> {
  #array: Accessor<(T | Accessor<T>)[]>
  #setArray: Setter<(T | Accessor<T>)[]>
  constructor(public name: string = "") {
    ;[this.#array, this.#setArray] = createSignal<(T | Accessor<T>)[]>([], {
      equals: false,
    })
  }
  /**
   * Returns the complete stack.
   * @returns Returns the complete stack.
   */
  all() {
    return this.#array()
  }
  /**
   * Returns the top element of the stack without removing it.
   * @returns The top element of the stack.
   */
  peek(): T | undefined {
    const array = this.#array()
    const top = array[array.length - 1]
    return typeof top === "function" ? (top as Accessor<T>)() : top
  }
  /**
   * Adds a value `T` or `Accessor<T>` to the stack.
   * Value is automatically removed from stack on cleanup.
   * @param item - The value to add to the stack.
   * @returns A cleanup function to remove the value from the stack.
   */
  push(item: T | Accessor<T>) {
    this.#setArray(array => {
      const index = array.indexOf(item)
      if (index !== -1) array.splice(index, 1)
      array.push(item)
      return array
    })
    if (getOwner() === null) {
      console.warn(
        `An item is added to ${this.name}-stack outside a \`createRoot\` or \`render\`.
  Remember to remove the item manually by calling the returned disposal-function.`,
        { item },
      )
    } else {
      onCleanup(() => this.remove(item))
    }

    return () => this.remove(item)
  }
  /**
   * Removes a value from the stack.
   * @private
   * @param item - The value to remove from the stack.
   */
  remove(item: T | Accessor<T>) {
    this.#setArray(array => {
      const index = array.indexOf(item)
      if (index === -1) return array
      array.splice(index, 1)
      return array
    })
  }
}
