import type { EmberAPI } from '../shared/ipc'

declare global {
  interface Window {
    ember: EmberAPI
  }
}

export {}
