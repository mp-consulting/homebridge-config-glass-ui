import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'

import '../../src/global-defaults.ts'
import './scss/styles.scss'

// A deploy replaced the hashed chunks this page was built against: reload to
// pick up the new index.html (replaces the Angular router NavigationError hook).
window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
