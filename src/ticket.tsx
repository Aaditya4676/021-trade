import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, CircleHelp, Minus, Plus } from 'lucide-react'
import { money, orderError, OrderValidationError, parseQuantity, placeOrder, STOCKS } from './domain.ts'
import type { Account, Order, Side, Symbol } from './domain.ts'
import type { MarketFeed } from './market.ts'
import type { AccountStore } from './storage.ts'
import { failureMessage, Flash, useQuote } from './ui.tsx'
import type { OpenTicket } from './ui.tsx'

function marketOrder(feed: MarketFeed, symbol: Symbol, side: Side, quantity: number): Omit<Order, 'value'> {
  const time = Date.now()
  return { id: crypto.randomUUID(), symbol, side, quantity, time, price: feed.currentPrice(symbol, time) }
}

function focusConfirmation(element: HTMLHeadingElement | null) { element?.focus() }

export function Ticket({ account, store, feed, symbol, select, showOrders }: {
  account: Account; store: AccountStore; feed: MarketFeed; symbol: Symbol; select: OpenTicket; showOrders: () => void
}) {
  const [side, setSide] = useState<Side>('buy')
  const [raw, setRaw] = useState('1')
  const [decline, setDecline] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<Order | null>(null)
  const locked = useRef(false)
  const quote = useQuote(feed, symbol)
  const quantity = parseQuantity(raw)
  const available = account.holdings[symbol]?.quantity ?? 0
  const advisory = quantity === null ? 'Enter a positive whole number of shares.' : orderError(account, { symbol, side, quantity, price: quote.price })
  const visibleError = error || advisory
  const sideLabel = side === 'buy' ? 'Buy' : 'Sell'

  function setQuantity(value: string) { setRaw(value); setError(''); setDecline('') }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current) return
    setDecline('')
    setError('')
    if (!quantity) return
    const request = marketOrder(feed, symbol, side, quantity)
    locked.current = true
    setPending(true)
    try {
      const updated = await store.mutate(current => placeOrder(current, request))
      setConfirmation(updated.orders.find(order => order.id === request.id)!)
    } catch (error) {
      if (error instanceof OrderValidationError) {
        setDecline(`Your previous order was declined at ${money(request.price)}. Review the current estimate before retrying.`)
        try { await store.read() } catch (readError) { setError(failureMessage(readError)) }
      } else {
        setError(failureMessage(error))
      }
      locked.current = false
    } finally { setPending(false) }
  }

  function newOrder() {
    setConfirmation(null)
    setQuantity('1')
    locked.current = false
  }

  return <aside className="panel ticket" id="trade-ticket" aria-labelledby="ticket-heading">
    <div className="panel-title ticket-heading"><div><h2 id="ticket-heading" tabIndex={-1}>Order ticket</h2><p>Simulated market order</p></div><span className="ticket-icon"><ArrowDownLeft size={17} /><ArrowUpRight size={17} /></span></div>
    {confirmation ? <div className="ticket-body confirmation" aria-label="Order confirmation">
      <div className="confirmation-mark"><Check size={25} /></div>
      <h3 tabIndex={-1} ref={focusConfirmation}>Order filled</h3>
      <p>{confirmation.side === 'buy' ? 'Bought' : 'Sold'} {confirmation.quantity} {confirmation.quantity === 1 ? 'share' : 'shares'} of <strong>{confirmation.symbol}</strong>.</p>
      <dl className="receipt"><div><dt>Execution price</dt><dd>{money(confirmation.price)}</dd></div><div><dt>Order value</dt><dd>{money(confirmation.value)}</dd></div></dl>
      <button type="button" className="button primary full" onClick={showOrders}>View order history</button>
      <button type="button" className="button secondary full" onClick={newOrder}>New order</button>
    </div> : <form className="ticket-body" onSubmit={submit} noValidate>
      <div className="segmented side-tabs" role="group" aria-label="Order side">
        <button type="button" aria-pressed={side === 'buy'} disabled={pending} onClick={() => { setSide('buy'); setError(''); setDecline('') }}><ArrowDownLeft size={15} /> Buy</button>
        <button type="button" aria-pressed={side === 'sell'} disabled={pending} onClick={() => { setSide('sell'); setError(''); setDecline('') }}><ArrowUpRight size={15} /> Sell</button>
      </div>
      <label className="field">Stock<span className="select-wrap"><select disabled={pending} value={symbol} onChange={event => { setError(''); setDecline(''); select(event.target.value as Symbol) }}>{STOCKS.map(stock => <option key={stock.symbol}>{stock.symbol}</option>)}</select><ChevronDown size={16} /></span></label>
      <label className="field" htmlFor="order-quantity">Quantity</label>
      <div className="quantity-control"><button type="button" disabled={pending || (quantity ?? 0) <= 1} aria-label="Decrease quantity" onClick={() => setQuantity(String(Math.max(1, (quantity ?? 1) - 1)))}><Minus size={15} /></button>
        <input id="order-quantity" inputMode="numeric" maxLength={16} value={raw} disabled={pending} aria-invalid={Boolean(visibleError)} aria-describedby={visibleError ? 'order-error' : undefined} onChange={event => setQuantity(event.target.value)} />
        <button type="button" disabled={pending || quantity === Number.MAX_SAFE_INTEGER} aria-label="Increase quantity" onClick={() => setQuantity(String((quantity ?? 0) + 1))}><Plus size={15} /></button></div>
      {visibleError && <p className="inline-error" id="order-error" role="alert">{visibleError}</p>}
      {decline && !visibleError && <p role="status" className="ticket-note">{decline}</p>}
      <dl className="ticket-breakdown">
        <div><dt>Live price</dt><dd><Flash quote={quote}>{money(quote.price)}</Flash></dd></div>
        <div><dt>{side === 'buy' ? 'Buying power' : 'Shares held'}</dt><dd>{side === 'buy' ? money(account.cash) : new Intl.NumberFormat('en-IN').format(available)}</dd></div>
        <div className="estimated"><dt>Estimated value</dt><dd>{quantity === null ? '—' : money(BigInt(quantity) * BigInt(quote.price))}</dd></div>
      </dl>
      <button className={`button primary full ${side === 'sell' ? 'sell-submit' : ''}`} disabled={pending || Boolean(advisory)}>{pending ? 'Placing order…' : `${sideLabel} ${symbol}`}</button>
      <p className="ticket-note"><CircleHelp size={15} /><span>Fills at the live price when submitted. Paper funds only.</span></p>
    </form>}
  </aside>
}
