import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import { App } from './App'
import { useApp } from './store/app'
import { useChats } from './store/chats'

// Handle for automated UI tests (scripts/e2e-ui.mjs); harmless in the sandboxed renderer.
Object.defineProperty(window, '__emberStores', { value: { useApp, useChats } })

createRoot(document.getElementById('root')!).render(<App />)
