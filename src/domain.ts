export const STOCKS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', initials: 'R', base: 128475, close: 127130, color: '#6664aa' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', initials: 'T', base: 351820, close: 354610, color: '#69639e' },
  { symbol: 'INFY', name: 'Infosys', initials: 'I', base: 152680, close: 150750, color: '#327a8c' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', initials: 'H', base: 96840, close: 96260, color: '#4a66a8' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', initials: 'IC', base: 138570, close: 137440, color: '#a45a32' },
  { symbol: 'SBIN', name: 'State Bank of India', initials: 'S', base: 89325, close: 90020, color: '#377bac' },
  { symbol: 'ITC', name: 'ITC Limited', initials: 'IT', base: 41265, close: 41520, color: '#8d6a36' },
  { symbol: 'LT', name: 'Larsen & Toubro', initials: 'L', base: 346595, close: 341880, color: '#6e639b' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', initials: 'A', base: 177820, close: 175960, color: '#ac525a' },
  { symbol: 'AXISBANK', name: 'Axis Bank', initials: 'AX', base: 115840, close: 116290, color: '#9a537a' },
] as const

export type Symbol = (typeof STOCKS)[number]['symbol']
export type Stock = (typeof STOCKS)[number]
export type Side = 'buy' | 'sell'
export type Direction = 'above' | 'below'

export const STOCK_BY_SYMBOL = Object.fromEntries(STOCKS.map(stock => [stock.symbol, stock])) as Record<Symbol, Stock>
export const STARTING_CASH = 100_000_000n

export interface Watchlist { id: string; name: string; symbols: Symbol[] }
export interface Holding { quantity: number; cost: bigint }
export interface Order { id: string; symbol: Symbol; side: Side; quantity: number; price: number; value: bigint; time: number; sale?: { costBasis: bigint; averageBuyPrice: bigint } }
export type OrderRequest = Omit<Order, 'value' | 'sale'>
export interface Alert {
  id: string
  symbol: Symbol
  direction: Direction
  target: number
  createdAtTick: number
  triggered?: { price: number; time: number }
}

export interface Account {
  revision: number
  marketEpoch: number
  watchlists: Watchlist[]
  cash: bigint
  holdings: Partial<Record<Symbol, Holding>>
  orders: Order[]
  alerts: Alert[]
}

export function initialAccount(now = Date.now()): Account {
  return {
    revision: 0, marketEpoch: now, cash: STARTING_CASH, holdings: {}, orders: [], alerts: [],
    watchlists: [{ id: 'core', name: 'Core watchlist', symbols: ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK'] }],
  }
}

const indianNumber = new Intl.NumberFormat('en-IN')
const fixedPercent = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function money(paise: bigint | number, options: { currency?: boolean; signed?: boolean } = {}): string {
  const amount = BigInt(paise)
  const absolute = amount < 0n ? -amount : amount
  const sign = amount < 0n ? '−' : options.signed && amount > 0n ? '+' : ''
  const currency = options.currency === false ? '' : '₹'
  return `${sign}${currency}${indianNumber.format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`
}

export function percent(value: number): string {
  const sign = value < 0 ? '−' : value > 0 ? '+' : ''
  return `${sign}${fixedPercent.format(Math.abs(value))}%`
}

export function pnlPercent(pnl: bigint, cost: bigint): number {
  if (cost === 0n) return 0
  const absolute = pnl < 0n ? -pnl : pnl
  const basisPoints = (absolute * 10_000n + cost / 2n) / cost
  return Number(pnl < 0n ? -basisPoints : basisPoints) / 100
}

export function parseTarget(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  return paise > 0n && paise <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(paise) : null
}

export function parseQuantity(input: string): number | null {
  const digits = input.trim()
  if (!/^\d+$/.test(digits)) return null
  const quantity = Number(digits)
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null
}

export function orderError(account: Account, request: Pick<Order, 'symbol' | 'side' | 'quantity' | 'price'>): string | null {
  const { symbol, side, quantity, price } = request
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return 'Enter a positive whole number of shares.'
  if (!Number.isSafeInteger(price) || price <= 0) return 'A current price is unavailable. Try again.'
  const held = account.holdings[symbol]?.quantity ?? 0
  if (side === 'sell' && quantity > held) return `You can sell up to ${indianNumber.format(held)} shares.`
  if (side === 'buy' && BigInt(quantity) * BigInt(price) > account.cash) return 'Insufficient buying power for this order.'
  if (side === 'buy' && !Number.isSafeInteger(quantity + held)) return 'This order exceeds the maximum holding size.'
  return null
}

export class OrderValidationError extends Error {}

export function averageCost(holding: Holding): bigint {
  const quantity = BigInt(holding.quantity)
  return (holding.cost + quantity / 2n) / quantity
}

export function costOfShares(holding: Holding, quantity: number): bigint {
  return holding.cost * BigInt(quantity) / BigInt(holding.quantity)
}

export function placeOrder(account: Account, request: OrderRequest): Account {
  if (account.orders.some(order => order.id === request.id)) return account
  const error = orderError(account, request)
  if (error) throw new OrderValidationError(error)

  const { symbol, side, quantity, price } = request
  const value = BigInt(quantity) * BigInt(price)
  const order: Order = { ...request, value }
  const old = account.holdings[symbol] ?? { quantity: 0, cost: 0n }
  const holdings = { ...account.holdings }
  if (side === 'buy') {
    holdings[symbol] = { quantity: old.quantity + quantity, cost: old.cost + value }
  } else {
    const costBasis = costOfShares(old, quantity)
    order.sale = { costBasis, averageBuyPrice: averageCost(old) }
    if (quantity === old.quantity) delete holdings[symbol]
    else holdings[symbol] = { quantity: old.quantity - quantity, cost: old.cost - costBasis }
  }

  return {
    ...account, holdings, cash: side === 'buy' ? account.cash - value : account.cash + value,
    orders: [order, ...account.orders].sort((a, b) => b.time - a.time),
  }
}

export function holdingValue(holding: Holding, price: number) {
  const quantity = BigInt(holding.quantity)
  const value = quantity * BigInt(price)
  const pnl = value - holding.cost
  return { value, pnl, rate: pnlPercent(pnl, holding.cost), average: averageCost(holding) }
}

export function reorder(symbols: Symbol[], source: Symbol, destination: Symbol): Symbol[] {
  const from = symbols.indexOf(source)
  const to = symbols.indexOf(destination)
  if (from === -1 || to === -1 || from === to) return symbols
  const next = [...symbols]
  next.splice(from, 1)
  next.splice(to, 0, source)
  return next
}

export function crossed(direction: Direction, target: number, previous: number, price: number): boolean {
  return direction === 'above' ? previous < target && price >= target : previous > target && price <= target
}
