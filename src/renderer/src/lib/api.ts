/** Typed access to the preload bridge. Always import `ember` from here. */
import type { EmberAPI } from '@shared/ipc'

export const ember: EmberAPI = window.ember
