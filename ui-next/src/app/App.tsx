import { lazy, Suspense } from 'react'

// TEMPORARY (Phase 0): dev-only spike pages, selected with `?spike=<name>`.
// Production builds drop them entirely, unless built with VITE_SPIKES=1 (used
// to check them against `vite preview` output from a scratch outDir).
const SPIKES_ENABLED = import.meta.env.DEV || import.meta.env.VITE_SPIKES === '1'

const MonacoSpikeDemo = SPIKES_ENABLED && lazy(() => import('@/core/monaco/spike/MonacoSpikeDemo').then(m => ({ default: m.MonacoSpikeDemo })))

function spikeName(): string | null {
  if (!SPIKES_ENABLED) {
    return null
  }
  return new URLSearchParams(window.location.search).get('spike')
}

export function App() {
  if (MonacoSpikeDemo && spikeName() === 'monaco') {
    return (
      <Suspense fallback={null}>
        <MonacoSpikeDemo />
      </Suspense>
    )
  }

  return (
    <div className="container py-5">
      <h1 className="h3">Homebridge Glass UI</h1>
      <p className="text-muted">React migration in progress (ui-next).</p>
    </div>
  )
}
