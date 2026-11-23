import { memo, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BarChart3, Radio } from 'lucide-react'
import { money, percent, STOCK_BY_SYMBOL, STOCKS } from './domain.ts'
import type { Symbol } from './domain.ts'
import type { MarketFeed, Quote } from './market.ts'
import { Flash, SymbolMark, tone, useQuote } from './ui.tsx'
import type { OpenTicket } from './ui.tsx'

const RANGES = [{ label: '1m', seconds: 60 }, { label: '5m', seconds: 300 }, { label: '15m', seconds: 900 }] as const
const chartTime = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function drawChart(canvas: HTMLCanvasElement, points: { price: number; time: number }[], pointer: number | null, dark: boolean) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const dpi = window.devicePixelRatio || 1
  const context = canvas.getContext('2d')
  if (!width || !height || !context) return
  if (canvas.width !== Math.round(width * dpi) || canvas.height !== Math.round(height * dpi)) {
    canvas.width = Math.round(width * dpi)
    canvas.height = Math.round(height * dpi)
  }
  context.setTransform(dpi, 0, 0, dpi, 0, 0)
  context.clearRect(0, 0, width, height)
  const left = 3
  const right = width - 66
  const top = 10
  const bottom = height - 25
  const completed = points.slice(1, -1).map(point => point.price)
  const minimum = Math.min(...completed)
  const maximum = Math.max(...completed)
  const padding = Math.max(20, Math.round((maximum - minimum) * 0.16))
  const firstPrice = points[0].price
  const lastPrice = points[points.length - 1].price
  const low = Math.min(minimum - padding, firstPrice, lastPrice)
  const high = Math.max(maximum + padding, firstPrice, lastPrice)
  const start = points[0].time
  const end = points[points.length - 1].time
  const x = (time: number) => left + (time - start) / (end - start) * (right - left)
  const y = (price: number) => bottom - (price - low) / (high - low) * (bottom - top)

  context.font = '11px Manrope, sans-serif'
  context.lineWidth = 1
  context.fillStyle = dark ? '#a8b9b1' : '#66716d'
  context.strokeStyle = dark ? '#34453d' : '#e9ede8'
  context.textAlign = 'left'
  for (let row = 0; row <= 4; row++) {
    const axisY = top + (bottom - top) * row / 4
    context.beginPath()
    context.moveTo(left, axisY)
    context.lineTo(right, axisY)
    context.stroke()
    context.fillText(money(Math.round(high - (high - low) * row / 4), { currency: false }), right + 9, axisY + 4)
  }
  const divisions = width < 420 ? 3 : 5
  for (let column = 0; column <= divisions; column++) {
    const time = start + (end - start) * column / divisions
    const axisX = x(time)
    context.beginPath()
    context.moveTo(axisX, top)
    context.lineTo(axisX, bottom)
    context.stroke()
    context.textAlign = column === 0 ? 'left' : column === divisions ? 'right' : 'center'
    context.fillText(chartTime.format(time), axisX, height - 6)
  }

  const line = new Path2D()
  line.moveTo(left, y(points[0].price))
  for (const point of points.slice(1)) line.lineTo(x(point.time), y(point.price))
  const area = new Path2D(line)
  area.lineTo(right, bottom)
  area.lineTo(left, bottom)
  area.closePath()
  const fill = context.createLinearGradient(0, top, 0, bottom)
  fill.addColorStop(0, 'rgba(34, 140, 106, .22)')
  fill.addColorStop(1, 'rgba(34, 140, 106, .025)')
  context.fillStyle = fill
  context.fill(area)
  context.strokeStyle = dark ? '#7ccfa7' : '#198762'
  context.lineWidth = 1.85
  context.lineJoin = 'round'
  context.stroke(line)

  const point = pointer === null ? points[points.length - 1] : points.reduce((nearest, sample) =>
    Math.abs(x(sample.time) - pointer) < Math.abs(x(nearest.time) - pointer) ? sample : nearest)
  const pointX = x(point.time)
  const pointY = y(point.price)
  if (pointer !== null) {
    context.strokeStyle = '#899b92'
    context.lineWidth = 1
    context.setLineDash([4, 4])
    context.beginPath()
    context.moveTo(pointX, top)
    context.lineTo(pointX, bottom)
    context.stroke()
    context.setLineDash([])
  }
  context.fillStyle = dark ? '#7ccfa7' : '#198762'
  context.beginPath()
  context.arc(pointX, pointY, 3.5, 0, 2 * Math.PI)
  context.fill()
  if (pointer !== null) {
    const label = `${chartTime.format(point.time)}  ${money(point.price)}`
    const labelWidth = context.measureText(label).width + 18
    const labelX = Math.min(right - labelWidth, Math.max(left, pointX + 10))
    context.fillStyle = '#1e3830'
    context.beginPath()
    context.roundRect(labelX, top + 1, labelWidth, 23, 4)
    context.fill()
    context.textAlign = 'left'
    context.fillStyle = '#fff'
    context.fillText(label, labelX + 9, top + 16)
  }
}

function PriceChart({ feed, symbol, quote, seconds, dark }: { feed: MarketFeed; symbol: Symbol; quote: Quote; seconds: number; dark: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<number | null>(null)
  const points = useRef<{ price: number; time: number }[]>([])
  useLayoutEffect(() => {
    const element = canvas.current!
    const paint = () => { if (points.current.length) drawChart(element, points.current, pointer.current, dark) }
    const track = (event: PointerEvent) => { pointer.current = event.offsetX; paint() }
    const reset = () => { pointer.current = null; paint() }
    const resize = new ResizeObserver(paint)
    resize.observe(element)
    element.addEventListener('pointermove', track)
    element.addEventListener('pointerleave', reset)
    return () => {
      resize.disconnect()
      element.removeEventListener('pointermove', track)
      element.removeEventListener('pointerleave', reset)
    }
  }, [dark])
  useLayoutEffect(() => {
    points.current = feed.history(symbol, seconds, 100, quote.index)
    drawChart(canvas.current!, points.current, pointer.current, dark)
  }, [feed, symbol, seconds, quote.index, dark])
  return <canvas className="price-chart" ref={canvas} role="img" aria-label={`${symbol} price trend over the last ${seconds / 60} minutes. Current price ${money(quote.price)}.`} />
}

export function Instrument({ feed, symbol, dark }: { feed: MarketFeed; symbol: Symbol; dark: boolean }) {
  const [seconds, setSeconds] = useState<number>(60)
  const quote = useQuote(feed, symbol)
  const stock = STOCK_BY_SYMBOL[symbol]
  const Move = quote.change >= 0 ? ArrowUpRight : ArrowDownRight
  return <section className="panel instrument" aria-label="Instrument chart">
    <div className="instrument-head"><div className="instrument-id"><SymbolMark symbol={symbol} large /><div><h2>{symbol}</h2><p>{stock.name} <span>·</span> NSE</p></div></div><span className="instrument-kind">Equity</span></div>
    <div className="instrument-details">
      <div className="instrument-value"><strong>{money(quote.price)}</strong><span className={`move-badge ${tone(quote.change)}`}><Move size={14} />{percent(quote.rate)}</span></div>
      <div className="segmented chart-ranges" role="group" aria-label="Chart period">
        {RANGES.map(range => <button type="button" key={range.label} aria-pressed={seconds === range.seconds} onClick={() => setSeconds(range.seconds)}>{range.label}</button>)}
      </div>
    </div>
    <div className="chart-wrap"><PriceChart feed={feed} symbol={symbol} quote={quote} seconds={seconds} dark={dark} /></div>
  </section>
}

const MarketValues = memo(function MarketValues({ feed, symbol }: { feed: MarketFeed; symbol: Symbol }) {
  const quote = useQuote(feed, symbol)
  return <><td className="numeric strong"><Flash quote={quote}>{money(quote.price)}</Flash></td><td className={`numeric ${tone(quote.change)}`}>{money(quote.change, { signed: true })}</td><td className={`numeric ${tone(quote.change)}`}><span className="market-percent">{percent(quote.rate)}</span></td></>
})

export function MarketTable({ feed, selected, openTicket }: { feed: MarketFeed; selected: Symbol; openTicket: OpenTicket }) {
  return <section className="panel market-panel" aria-labelledby="market-heading">
    <div className="panel-title"><div><h2 id="market-heading"><BarChart3 size={18} /> Market prices</h2><p>10 NSE equities</p></div><span className="feed-tag"><Radio size={14} /> Streaming</span></div>
    <div className="table-scroll"><table>
      <thead><tr><th scope="col">Instrument</th><th scope="col" className="numeric">Last price</th><th scope="col" className="numeric">Change</th><th scope="col" className="numeric">Change %</th></tr></thead>
      <tbody>{STOCKS.map(stock => <tr key={stock.symbol} className={selected === stock.symbol ? 'selected' : ''} onClick={() => openTicket(stock.symbol)}>
        <td><button className="table-symbol" type="button" aria-label={`Trade ${stock.symbol} from market`}><SymbolMark symbol={stock.symbol} /><span><strong>{stock.symbol}</strong><small>{stock.name}</small></span></button></td>
        <MarketValues feed={feed} symbol={stock.symbol} />
      </tr>)}</tbody>
    </table></div>
  </section>
}
