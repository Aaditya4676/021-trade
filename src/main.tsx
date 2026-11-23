import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import { App } from './app.tsx'
import { AccountStore } from './storage.ts'
import './style.css'

const root = createRoot(document.getElementById('root')!)

async function start() {
  root.render(<div className="boot" role="status">Opening your trading workspace…</div>)
  try {
    const store = new AccountStore(error => window.dispatchEvent(new CustomEvent('workspace-sync-error', { detail: error })))
    await store.mutate(account => account)
    root.render(<StrictMode><App store={store} /></StrictMode>)
  } catch {
    root.render(<div className="boot" role="alert"><h1>Workspace unavailable</h1><p>Check that this browser allows local site storage, then retry.</p><button className="button primary" type="button" onClick={() => window.location.reload()}>Retry</button></div>)
  }
}

void start()
