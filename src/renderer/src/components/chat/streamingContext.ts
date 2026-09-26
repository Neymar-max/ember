/** Lets a fenced code block know whether the Markdown it's rendering inside is still streaming
 * (R3), without threading a prop through react-markdown's module-level `components` map. Default
 * `false` is correct for every CodeBlock rendered outside a <Markdown streaming> tree (e.g. tool
 * bodies), which should always highlight normally. */
import { createContext, useContext } from 'react'

const StreamingContext = createContext(false)

export const StreamingProvider = StreamingContext.Provider

export function useIsStreaming(): boolean {
  return useContext(StreamingContext)
}
