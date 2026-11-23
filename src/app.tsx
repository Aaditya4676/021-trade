import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Activity, Bell, CandlestickChart, ClipboardList, LayoutGrid, Radio, ShieldAlert, Wallet, X } from 'lucide-react'
import { Alerts, Holdings, Orders } from './account-views.tsx'
import { crossed, money } from './domain.ts'
import type { Symbol } from './domain.ts'
import { Instrument, MarketTable } from './market-view.tsx'
import { MarketFeed } from './market.ts'
import type { Tick } from './market.ts'
import type { AccountStore } from './storage.ts'
import { Ticket } from './ticket.tsx'
import { failureMessage } from './ui.tsx'
import type { ToastMessage } from './ui.tsx'
import { Watchlists } from './watchlists.tsx'

const PAGES = {
  terminal: { label: 'Terminal', icon: LayoutGrid, title: 'Trading terminal', description: 'Track live prices and trade NSE equities with paper funds.' },
  holdings: { label: 'Holdings', icon: Wallet, title: 'Holdings', description: 'Monitor open positions and profit and loss as prices move.' },
  orders: { label: 'Orders', icon: ClipboardList, title: 'Orders', description: 'Review fills and execution prices for your simulated trades.' },
  alerts: { label: 'Alerts', icon: Bell, title: 'Price alerts', description: 'Get an in-app notification when a stock crosses your target price.' },
} as const
type Page = keyof typeof PAGES

function getPage(): Page {
  const hash = window.location.hash.slice(1)
  return Object.hasOwn(PAGES, hash) ? hash as Page : 'terminal'
}

function subscribePage(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => { window.removeEventListener('hashchange', listener) }
}

function useAlertNotifications(store: AccountStore, feed: MarketFeed, announce: (message: ToastMessage) => void) {
  useEffect(() => {
    const pending = new Set<string>()
    return feed.subscribeTicks(ticks => {
      const active = store.snapshot()?.alerts.filter(alert => !alert.triggered && !pending.has(alert.id))
      if (!active?.length) return
      const crossings = new Map<string, Tick>()
      for (const alert of active) {
        const hit = ticks.find(tick => tick.symbol === alert.symbol && tick.index > alert.createdAtTick && crossed(alert.direction, alert.target, tick.previous, tick.price))
        if (hit) crossings.set(alert.id, hit)
      }
      if (!crossings.size) return
      for (const id of crossings.keys()) pending.add(id)
      const messages: ToastMessage[] = []
      void store.mutate(current => {
        const alerts = current.alerts.map(alert => {
          const tick = crossings.get(alert.id)
          if (!tick || alert.triggered || tick.index <= alert.createdAtTick) return alert
          messages.push({ id: alert.id, title: `${alert.symbol} price alert`, detail: `Crossed ${alert.direction} ${money(alert.target)} at ${money(tick.price)}.` })
          return { ...alert, triggered: { price: tick.price, time: tick.time } }
        })
        return messages.length ? { ...current, alerts } : current
      }).then(() => messages.forEach(announce))
        .catch(error => announce({ id: 'alert-write', title: 'Alert could not be saved', detail: failureMessage(error), error: true }))
        .finally(() => { for (const id of crossings.keys()) pending.delete(id) })
    })
  }, [store, feed, announce])
}

function Notification({ message, dismiss }: { message: ToastMessage; dismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(message.id), 9000)
    return () => window.clearTimeout(timer)
  }, [message.id, dismiss])
  return <div className={`toast${message.error ? ' toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>
    <span className="toast-mark">{message.error ? <ShieldAlert size={18} /> : <Bell size={18} />}</span>
    <div><strong>{message.title}</strong><p>{message.detail}</p></div><button type="button" className="icon-button" aria-label={`Dismiss ${message.title}`} onClick={() => dismiss(message.id)}><X size={16} /></button>
  </div>
}

export function App({ store }: { store: AccountStore }) {
  const account = useSyncExternalStore(store.subscribe, store.snapshot)!
  const feed = useMemo(() => new MarketFeed(account.marketEpoch), [account.marketEpoch])
  const page = useSyncExternalStore(subscribePage, getPage)
  const [symbol, setSymbol] = useState<Symbol>('RELIANCE')
  const [ticketVersion, setTicketVersion] = useState(0)
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const announce = useCallback((message: ToastMessage) => setMessages(current => [...current.filter(item => item.id !== message.id), message]), [])
  const dismiss = useCallback((id: string) => setMessages(current => current.filter(item => item.id !== id)), [])
  useAlertNotifications(store, feed, announce)
  useEffect(() => feed.start(), [feed])
  useEffect(() => {
    const onError = (event: Event) => announce({ id: 'sync-error', title: 'Could not sync workspace', detail: failureMessage((event as CustomEvent).detail), error: true })
    window.addEventListener('workspace-sync-error', onError)
    return () => { window.removeEventListener('workspace-sync-error', onError) }
  }, [announce])

  function navigate(next: Page) {
    window.location.hash = next
    window.scrollTo(0, 0)
  }

  const openTicket = useCallback((next: Symbol) => {
    setSymbol(next)
    setTicketVersion(version => version + 1)
    window.requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 960px)').matches) {
        document.getElementById('trade-ticket')?.scrollIntoView({ block: 'start' })
      } else {
        document.getElementById('order-quantity')?.focus({ preventScroll: true })
      }
    })
  }, [])

  const ticket = <Ticket key={ticketVersion} account={account} store={store} feed={feed} symbol={symbol} select={setSymbol} showOrders={() => navigate('orders')} />
  const meta = PAGES[page]

  return <>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    <header className="topbar"><div className="topbar-inner">
      <a href="#terminal" className="brand" onClick={() => window.scrollTo(0, 0)}><span className="brand-mark"><CandlestickChart size={22} strokeWidth={2} /></span><span>021<span> Trade</span></span></a>
      <nav aria-label="Workspace">{(Object.keys(PAGES) as Page[]).map(id => {
        const { icon: Icon, label } = PAGES[id]
        return <a key={id} href={`#${id}`} aria-current={page === id ? 'page' : undefined} onClick={() => window.scrollTo(0, 0)}><Icon size={16} />{label}</a>
      })}</nav>
      <div className="topbar-status"><span className="live-dot" /> Live simulation</div>
    </div></header>

    <main className="container" id="main-content" tabIndex={-1}>
      <header className="page-heading"><div><h1>{meta.title}</h1><p>{meta.description}</p></div>
        <div className="cash-pill"><span className="cash-icon"><Wallet size={18} /></span><dl><dt>Buying power</dt><dd>{money(account.cash)}</dd></dl></div>
      </header>
      {page === 'terminal' && <div className="terminal-layout">
        <Watchlists account={account} store={store} feed={feed} openTicket={openTicket} selected={symbol} />
        <div className="content-stack terminal-center"><Instrument feed={feed} symbol={symbol} /><MarketTable feed={feed} selected={symbol} openTicket={openTicket} /></div>
        {ticket}
      </div>}
      {page === 'holdings' && <div className="split-layout"><Holdings holdings={account.holdings} feed={feed} openTicket={openTicket} showMarket={() => navigate('terminal')} />{ticket}</div>}
      {page === 'orders' && <Orders orders={account.orders} showMarket={() => navigate('terminal')} />}
      {page === 'alerts' && <Alerts alerts={account.alerts} store={store} feed={feed} />}
      <footer className="footer"><span><Activity size={14} /> 021 Trade</span><span><Radio size={14} /> Simulated NSE market data</span></footer>
    </main>
    <div className="toast-stack" aria-label="Notifications">{messages.map(message => <Notification key={message.id} message={message} dismiss={dismiss} />)}</div>
  </>
}
