import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const key = '021-trade-theme'
const system = window.matchMedia('(prefers-color-scheme: dark)')

function currentTheme(): Theme {
  const choice = document.documentElement.dataset.theme
  if (choice === 'light' || choice === 'dark') return choice
  return system.matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    const sync = () => setTheme(currentTheme())
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return
      if (event.newValue === 'light' || event.newValue === 'dark') document.documentElement.dataset.theme = event.newValue
      else delete document.documentElement.dataset.theme
      sync()
    }
    sync()
    window.addEventListener('storage', onStorage)
    system.addEventListener('change', sync)
    return () => {
      window.removeEventListener('storage', onStorage)
      system.removeEventListener('change', sync)
    }
  }, [])
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).backgroundColor)
  }, [theme])

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
    try { localStorage.setItem(key, next) } catch { /* Keep the choice for this tab when storage is unavailable. */ }
  }
  return { dark: theme === 'dark', toggleTheme }
}
