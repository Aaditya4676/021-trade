import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { X } from 'lucide-react'
import { STOCK_BY_SYMBOL } from './domain.ts'
import type { Symbol } from './domain.ts'
import type { MarketFeed, Quote } from './market.ts'

export type OpenTicket = (symbol: Symbol) => void
export type ToastMessage = { id: string; title: string; detail: string; error?: boolean }
export const tone = (value: number | bigint) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'

export function useQuote(feed: MarketFeed, symbol: Symbol) {
  const subscribe = useCallback((listener: () => void) => feed.subscribe(symbol, listener), [feed, symbol])
  const snapshot = useCallback(() => feed.quote(symbol), [feed, symbol])
  return useSyncExternalStore(subscribe, snapshot)
}

export function Flash({ quote, children }: { quote: Quote; children: ReactNode }) {
  const element = useRef<HTMLSpanElement>(null)
  const previousIndex = useRef(quote.index)
  const lastCue = useRef(-Infinity)
  useLayoutEffect(() => {
    const changed = previousIndex.current !== quote.index
    previousIndex.current = quote.index
    const now = performance.now()
    if (!changed || !quote.move || !element.current || now - lastCue.current < 1500) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    lastCue.current = now
    const color = quote.move > 0 ? 'var(--green)' : 'var(--red)'
    const underline = `inset 0 -1px color-mix(in srgb, ${color} 55%, transparent)`
    element.current.animate([
      { boxShadow: 'inset 0 -1px transparent' },
      { boxShadow: underline, offset: 0.3 },
      { boxShadow: 'inset 0 -1px transparent' },
    ], { duration: 420, easing: 'ease-in-out' })
  }, [quote])
  return <span className="flash" ref={element}>{children}</span>
}

export function SymbolMark({ symbol, large = false }: { symbol: Symbol; large?: boolean }) {
  const stock = STOCK_BY_SYMBOL[symbol]
  return <span aria-hidden="true" className={`symbol-mark${large ? ' large' : ''}`} style={{ '--symbol-color': stock.color } as CSSProperties}>{stock.initials}</span>
}

export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { element.close() }
  }, [])
  return <dialog ref={dialog} className="dialog" aria-labelledby="dialog-title" onCancel={close}>
    <div className="dialog-head">
      <h2 id="dialog-title">{title}</h2>
      <button type="button" className="icon-button" aria-label="Close dialog" onClick={close}><X size={19} /></button>
    </div>
    {children}
  </dialog>
}

export const timestamp = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kolkata' })
export const failureMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'
