import { STOCKS } from './domain.ts'
import type { Symbol } from './domain.ts'

export const TICKS_PER_SECOND = 60
const INTERVAL = 1000 / TICKS_PER_SECOND
const MAX_CATCHUP_TICKS = TICKS_PER_SECOND * 60 * 15
const STOCK_COUNT = STOCKS.length
const STOCK_INDEX = new Map(STOCKS.map((stock, index) => [stock.symbol, index]))
const PERIODS = [130, 330, 1470] as const

export interface Quote { price: number; change: number; rate: number; move: -1 | 0 | 1; index: number }
export interface Tick { symbol: Symbol; previous: number; price: number; index: number; time: number }

function noise(step: number, stock: number) {
  let n = Math.imul(step, 0x9e3779b1) ^ Math.imul(stock + 1, 0x85ebca6b)
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d)
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b)
  return ((n ^ (n >>> 16)) >>> 0) / 0xffff_ffff * 2 - 1
}

function wave(step: number, stock: number, period: number) {
  const knot = Math.floor(step / period)
  const fraction = step / period - knot
  const start = noise(knot, stock)
  return start + (noise(knot + 1, stock) - start) * fraction
}

export function priceAt(stockIndex: number, index: number): number {
  const step = Math.floor((index - stockIndex) / STOCK_COUNT)
  const { base } = STOCKS[stockIndex]
  const swing = wave(step, stockIndex, PERIODS[0]) * 0.005
    + wave(step, stockIndex + 13, PERIODS[1]) * 0.011
    + wave(step, stockIndex + 29, PERIODS[2]) * 0.018
    + wave(step, stockIndex + 41, 7) * 0.0015
    + noise(step, stockIndex + 59) * 0.00045
  return Math.round(base * (1 + swing))
}

type Listener = () => void

export class MarketFeed {
  readonly epoch: number
  private cursor: number
  private quotes: Record<Symbol, Quote>
  private listeners = new Map<Symbol, Set<Listener>>()
  private allListeners = new Set<Listener>()
  private tickListeners = new Set<(ticks: Tick[]) => void>()

  constructor(epoch: number, now = Date.now()) {
    this.epoch = epoch
    this.cursor = this.indexAt(now)
    this.quotes = this.snapshot(this.cursor)
  }

  indexAt = (time: number) => Math.floor((time - this.epoch) / INTERVAL)
  quote = (symbol: Symbol) => this.quotes[symbol]
  all = () => this.quotes
  currentPrice = (symbol: Symbol, time = Date.now()) => priceAt(STOCK_INDEX.get(symbol)!, this.indexAt(time))

  history(symbol: Symbol, seconds: number, count: number, end: number) {
    const stockIndex = STOCK_INDEX.get(symbol)!
    const start = end - seconds * TICKS_PER_SECOND
    const stride = Math.max(1, Math.round((end - start) / (count - 1)))
    const sample = (index: number) => ({ price: priceAt(stockIndex, index), time: this.epoch + index * INTERVAL })
    const points = [sample(start)]
    // Keep completed samples at fixed times as the visible window advances.
    for (let index = (Math.floor(start / stride) + 1) * stride; index < end; index += stride) {
      points.push(sample(index))
    }
    points.push(sample(end))
    return points
  }

  subscribe(symbol: Symbol, listener: Listener) {
    const listeners = this.listeners.get(symbol) ?? new Set()
    this.listeners.set(symbol, listeners)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  subscribeAll = (listener: Listener) => {
    this.allListeners.add(listener)
    return () => { this.allListeners.delete(listener) }
  }

  subscribeTicks(listener: (ticks: Tick[]) => void) {
    this.tickListeners.add(listener)
    return () => { this.tickListeners.delete(listener) }
  }

  private snapshot(index: number) {
    return Object.fromEntries(STOCKS.map((stock, position) => {
      const last = index - ((index - position) % STOCK_COUNT + STOCK_COUNT) % STOCK_COUNT
      const price = priceAt(position, last)
      const change = price - stock.close
      return [stock.symbol, { price, change, rate: change / stock.close * 100, move: 0, index: last }]
    })) as Record<Symbol, Quote>
  }

  advance(now: number) {
    const end = this.indexAt(now)
    if (end <= this.cursor) return
    const catchingUp = end - this.cursor > STOCK_COUNT * 2
    const start = Math.max(this.cursor + 1, end - MAX_CATCHUP_TICKS + 1)
    const ticks: Tick[] = []
    const next = { ...this.quotes }
    const changed = new Set<Symbol>()
    if (catchingUp) {
      const latest = this.snapshot(end)
      for (const { symbol } of STOCKS) {
        const move = Math.sign(latest[symbol].price - next[symbol].price) as Quote['move']
        if (!move) continue
        next[symbol] = { ...latest[symbol], move }
        changed.add(symbol)
      }
    }
    const first = catchingUp && !this.tickListeners.size ? end + 1 : start
    for (let index = first; index <= end; index++) {
      const stockIndex = (index % STOCK_COUNT + STOCK_COUNT) % STOCK_COUNT
      const stock = STOCKS[stockIndex]
      const previous = priceAt(stockIndex, index - STOCK_COUNT)
      const price = priceAt(stockIndex, index)
      if (price === previous) continue
      if (this.tickListeners.size) ticks.push({ symbol: stock.symbol, previous, price, index, time: this.epoch + index * INTERVAL })
      if (catchingUp) continue
      const change = price - stock.close
      const move = price > next[stock.symbol].price ? 1 : price < next[stock.symbol].price ? -1 : 0
      next[stock.symbol] = { price, change, rate: change / stock.close * 100, move, index }
      changed.add(stock.symbol)
    }
    this.cursor = end
    if (changed.size) {
      this.quotes = next
      for (const symbol of changed) this.listeners.get(symbol)?.forEach(listener => listener())
      this.allListeners.forEach(listener => listener())
    }
    if (ticks.length) this.tickListeners.forEach(listener => listener(ticks))
  }

  start() {
    const update = () => { if (!document.hidden) this.advance(Date.now()) }
    const timer = window.setInterval(update, 16)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }
}
