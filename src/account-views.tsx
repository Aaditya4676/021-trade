import { memo, useCallback, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, Bell, BellPlus, ChartNoAxesCombined, ChevronDown, ClipboardList, Trash2 } from 'lucide-react'
import { holdingValue, money, parseTarget, percent, pnlPercent, STOCKS } from './domain.ts'
import type { Account, Direction, Holding, Symbol } from './domain.ts'
import type { MarketFeed } from './market.ts'
import type { AccountStore } from './storage.ts'
import { failureMessage, Flash, SymbolMark, timestamp, tone, useQuote } from './ui.tsx'
import type { OpenTicket } from './ui.tsx'

type Sort = 'pnl' | 'symbol' | 'value'

const HoldingRow = memo(function HoldingRow({ symbol, holding, feed, openTicket }: { symbol: Symbol; holding: Holding; feed: MarketFeed; openTicket: OpenTicket }) {
  const quote = useQuote(feed, symbol)
  const { value, pnl, rate, average } = holdingValue(holding, quote.price)
  return <tr onClick={() => openTicket(symbol)}>
    <td><button type="button" className="table-symbol" aria-label={`Trade ${symbol} from holdings`}><SymbolMark symbol={symbol} /><strong>{symbol}</strong></button></td>
    <td className="numeric">{holding.quantity.toLocaleString('en-IN')}</td><td className="numeric">{money(average)}</td>
    <td className="numeric"><Flash quote={quote}>{money(quote.price)}</Flash></td><td className="numeric strong">{money(value)}</td>
    <td className={`numeric ${tone(pnl)}`}><strong>{money(pnl, { signed: true })}</strong><small className="cell-subtitle">{percent(rate)}</small></td>
  </tr>
})

function HoldingsSummary({ holdings, feed }: { holdings: Account['holdings']; feed: MarketFeed }) {
  const entries = Object.entries(holdings) as [Symbol, Holding][]
  const invested = entries.reduce((sum, [, holding]) => sum + holding.cost, 0n)
  const snapshot = useCallback(() => {
    let value = 0n
    for (const [symbol, holding] of Object.entries(holdings) as [Symbol, Holding][]) value += BigInt(holding.quantity) * BigInt(feed.quote(symbol).price)
    return value
  }, [feed, holdings])
  const value = useSyncExternalStore(feed.subscribeAll, snapshot)
  const pnl = value - invested
  return <dl className="portfolio-summary panel">
    <div><dt>Total invested</dt><dd>{money(invested)}</dd></div>
    <div><dt>Current value</dt><dd>{money(value)}</dd></div>
    <div><dt>Total P&amp;L</dt><dd className={tone(pnl)}>{money(pnl, { signed: true })}<small>{percent(pnlPercent(pnl, invested))}</small></dd></div>
  </dl>
}

export function Holdings({ holdings, feed, openTicket, showMarket }: { holdings: Account['holdings']; feed: MarketFeed; openTicket: OpenTicket; showMarket: () => void }) {
  const [sort, setSort] = useState<Sort>('pnl')
  const [descending, setDescending] = useState(true)

  const snapshot = useCallback(() => {
    const entries = Object.entries(holdings) as [Symbol, Holding][]
    const values = entries.map(([symbol, holding]) => {
      const value = BigInt(holding.quantity) * BigInt(feed.quote(symbol).price)
      return { symbol, value, pnl: value - holding.cost }
    })
    values.sort((a, b) => {
      const symbolOrder = a.symbol.localeCompare(b.symbol)
      if (sort === 'symbol') return descending ? -symbolOrder : symbolOrder
      const delta = a[sort] - b[sort]
      if (delta === 0n) return symbolOrder
      return (delta > 0n ? 1 : -1) * (descending ? -1 : 1)
    })
    return values.map(item => item.symbol).join(',')
  }, [feed, holdings, sort, descending])
  const ordering = useSyncExternalStore(feed.subscribeAll, snapshot)
  const sorted = ordering ? ordering.split(',') as Symbol[] : []

  function sortBy(field: Sort) {
    setDescending(field === sort ? !descending : field !== 'symbol')
    setSort(field)
  }

  function sortHeader(field: Sort, label: string, numeric = false) {
    const Chevron = descending ? ArrowDown : ArrowUp
    return <th scope="col" className={numeric ? 'numeric' : undefined} aria-sort={sort === field ? (descending ? 'descending' : 'ascending') : 'none'}><button type="button" className="sort-button" onClick={() => sortBy(field)}>{label}{sort === field && <Chevron size={13} />}</button></th>
  }

  return <div className="content-stack"><HoldingsSummary holdings={holdings} feed={feed} />
    <section className="panel" aria-labelledby="holdings-heading">
      <div className="panel-title"><div><h2 id="holdings-heading">Your positions</h2><p>{sorted.length} {sorted.length === 1 ? 'holding' : 'holdings'}</p></div></div>
      {sorted.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr>{sortHeader('symbol', 'Symbol')}<th scope="col" className="numeric">Qty</th><th scope="col" className="numeric">Average cost</th><th scope="col" className="numeric">Last price</th>{sortHeader('value', 'Current value', true)}{sortHeader('pnl', 'P&L', true)}</tr></thead>
        <tbody>{sorted.map(symbol => <HoldingRow key={symbol} symbol={symbol} holding={holdings[symbol]!} feed={feed} openTicket={openTicket} />)}</tbody>
      </table></div> : <div className="empty"><ChartNoAxesCombined size={29} /><h3>No open positions</h3><p>Buying a stock adds it to your portfolio.</p><button type="button" className="button secondary" onClick={showMarket}>Browse market</button></div>}
    </section>
  </div>
}

export function Orders({ orders, showMarket }: { orders: Account['orders']; showMarket: () => void }) {
  return <section className="panel" aria-labelledby="orders-heading">
    <div className="panel-title"><div><h2 id="orders-heading">Order history</h2><p>{orders.length} filled {orders.length === 1 ? 'order' : 'orders'}</p></div></div>
    {orders.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr><th scope="col">Symbol</th><th scope="col">Side</th><th scope="col" className="numeric">Qty</th><th scope="col" className="numeric">Fill price</th><th scope="col" className="numeric">Order value</th><th scope="col">Filled at (IST)</th></tr></thead>
      <tbody>{orders.map(order => <tr key={order.id}><td><span className="table-symbol"><SymbolMark symbol={order.symbol} /><strong>{order.symbol}</strong></span></td>
        <td><span className={`side-label ${order.side === 'buy' ? 'positive' : 'negative'}`}>{order.side === 'buy' ? 'Buy' : 'Sell'}</span></td>
        <td className="numeric">{order.quantity.toLocaleString('en-IN')}</td><td className="numeric">{money(order.price)}</td><td className="numeric strong">{money(order.value)}</td>
        <td><time dateTime={new Date(order.time).toISOString()}>{timestamp.format(order.time)}</time></td></tr>)}</tbody>
    </table></div> : <div className="empty"><ClipboardList size={29} /><h3>No filled orders</h3><p>Your simulated trades will appear here.</p><button type="button" className="button secondary" onClick={showMarket}>Browse market</button></div>}
  </section>
}

function AlertQuote({ feed, symbol }: { feed: MarketFeed; symbol: Symbol }) {
  const quote = useQuote(feed, symbol)
  return <Flash key={symbol} quote={quote}>{money(quote.price)}</Flash>
}

export function Alerts({ alerts, feed, store }: { alerts: Account['alerts']; feed: MarketFeed; store: AccountStore }) {
  const [symbol, setSymbol] = useState<Symbol>('RELIANCE')
  const [direction, setDirection] = useState<Direction>('above')
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const active = alerts.filter(alert => !alert.triggered)
  const triggered = alerts.filter(alert => alert.triggered).sort((a, b) => b.triggered!.time - a.triggered!.time)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const price = parseTarget(target)
    if (price === null) { setError('Enter a positive price with up to two decimal places.'); return }
    setBusy(true)
    setError('')
    const id = crypto.randomUUID()
    try {
      await store.mutate(current => ({ ...current, alerts: [{ id, symbol, direction, target: price, createdAtTick: feed.indexAt(Date.now()) }, ...current.alerts] }))
      setStatus(`Alert created for ${symbol}.`)
      setTarget('')
    } catch (error) { setError(failureMessage(error)) }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    setListError('')
    try { await store.mutate(current => ({ ...current, alerts: current.alerts.filter(alert => alert.id !== id) })) }
    catch (error) { setListError(failureMessage(error)) }
  }

  function alertList(title: string, items: Account['alerts'], empty: string) {
    return <section className="panel alert-list" aria-label={title}><div className="panel-title"><h2>{title}</h2><span className="count-chip">{items.length}</span></div>
      {items.length ? <ul>{items.map(alert => <li key={alert.id}>
        <SymbolMark symbol={alert.symbol} /><div className="alert-name"><strong>{alert.symbol}</strong><span>{alert.direction === 'above' ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}{alert.direction === 'above' ? 'Crosses above' : 'Crosses below'} {money(alert.target)}</span></div>
        {alert.triggered && <div className="alert-fill"><strong>{money(alert.triggered.price)}</strong><time dateTime={new Date(alert.triggered.time).toISOString()}>{timestamp.format(alert.triggered.time)}</time></div>}
        <button type="button" className="icon-button" aria-label={`Delete ${alert.symbol} ${alert.direction} ${money(alert.target)} alert`} onClick={() => void remove(alert.id)}><Trash2 size={17} /></button>
      </li>)}</ul> : <div className="alert-empty"><Bell size={18} /><span>{empty}</span></div>}
    </section>
  }

  return <div className="split-layout">
    <div className="content-stack">
      {listError && <p className="inline-error" role="alert">{listError}</p>}
      {alertList('Active alerts', active, 'Your active alerts will appear here.')}
      {alertList('Triggered alerts', triggered, 'No alerts have triggered yet.')}
    </div>
    <section className="panel alert-form" aria-labelledby="new-alert-heading"><div className="panel-title"><h2 id="new-alert-heading"><BellPlus size={18} /> Create alert</h2></div>
      <form className="ticket-body" onSubmit={create} noValidate>
        <label className="field">Stock<span className="select-wrap"><select value={symbol} onChange={event => setSymbol(event.target.value as Symbol)}>{STOCKS.map(stock => <option key={stock.symbol}>{stock.symbol}</option>)}</select><ChevronDown size={16} /></span></label>
        <div className="alert-quote"><span>Live price</span><strong><AlertQuote feed={feed} symbol={symbol} /></strong></div>
        <div className="field">Notify when price<div className="segmented side-tabs" role="group" aria-label="Alert direction">
          <button type="button" aria-pressed={direction === 'above'} onClick={() => setDirection('above')}><ArrowUpRight size={15} /> Crosses above</button>
          <button type="button" aria-pressed={direction === 'below'} onClick={() => setDirection('below')}><ArrowDownLeft size={15} /> Crosses below</button>
        </div></div>
        <label className="field">Target price (₹)<input value={target} inputMode="decimal" maxLength={16} aria-invalid={Boolean(error)} aria-describedby={error ? 'alert-error' : undefined} placeholder="0.00" onChange={event => { setTarget(event.target.value); setError(''); setStatus('') }} /></label>
        {error && <p className="inline-error" id="alert-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy}><BellPlus size={16} /> Set price alert</button>
        <span className="sr-only" role="status">{status}</span>
      </form>
    </section>
  </div>
}
