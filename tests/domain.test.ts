import assert from 'node:assert/strict'
import test from 'node:test'
import { crossed, holdingValue, initialAccount, money, parseQuantity, parseTarget, placeOrder, reorder, STARTING_CASH } from '../src/domain.ts'
import { MarketFeed, priceAt, TICKS_PER_SECOND } from '../src/market.ts'

test('rejects invalid quantities and converts decimal targets to exact paise', () => {
  for (const input of ['', '0', '-1', '1.5', '1e2', 'Infinity', '9007199254740992']) assert.equal(parseQuantity(input), null)
  for (const input of ['', '0.00', '-1', '1.001', 'NaN', '1e3']) assert.equal(parseTarget(input), null)
  assert.equal(parseQuantity(' 21 '), 21)
  assert.equal(parseTarget('1234.56'), 123456)
  assert.equal(parseTarget('7.1'), 710)
  assert.equal(money(STARTING_CASH), '₹10,00,000.00')
  assert.equal(money(-7n), '−₹0.07')
})

test('maintains exact cash and remaining cost basis through buys and partial sells', () => {
  const initial = initialAccount(0)
  const buy = { id: 'first', symbol: 'RELIANCE', side: 'buy', quantity: 2, price: 120001, time: 1 } as const
  let account = placeOrder(initial, buy)
  assert.equal(placeOrder(account, buy), account)
  account = placeOrder(account, { ...buy, id: 'second', quantity: 1, price: 120003, time: 2 })
  assert.equal(account.cash, STARTING_CASH - 360005n)
  assert.deepEqual(account.holdings.RELIANCE, { quantity: 3, cost: 360005n })
  assert.equal(holdingValue(account.holdings.RELIANCE!, 120099).pnl, 292n)
  assert.equal(holdingValue(account.holdings.RELIANCE!, 120099).average, 120002n)
  account = placeOrder(account, { ...buy, id: 'third', side: 'sell', quantity: 1, price: 130000, time: 3 })
  assert.equal(account.orders[0].sale?.costBasis, 120001n)
  assert.deepEqual(account.holdings.RELIANCE, { quantity: 2, cost: 240004n })
  account = placeOrder(account, { ...buy, id: 'fourth', side: 'sell', quantity: 2, price: 130001, time: 4 })
  assert.equal(account.orders[0].sale?.costBasis, 240004n)
  assert.equal(account.holdings.RELIANCE, undefined)
  assert.equal(account.cash, STARTING_CASH + 29997n)
  assert.deepEqual(account.orders.map(order => order.id), ['fourth', 'third', 'second', 'first'])
  assert.equal(initial.cash, STARTING_CASH)
})

test('rejects overspending, overselling and invalid direct order requests', () => {
  const account = initialAccount(0)
  const request = { id: 'first', symbol: 'TCS', side: 'buy', quantity: 1, price: 350000, time: 1 } as const
  assert.throws(() => placeOrder(account, { ...request, quantity: 500 }), /buying power/)
  assert.throws(() => placeOrder(account, { ...request, side: 'sell' }), /sell up to 0/)
  assert.throws(() => placeOrder(account, { ...request, quantity: 1.5 }), /whole number/)
  assert.throws(() => placeOrder(account, { ...request, price: 0 }), /unavailable/)
  assert.equal(account.orders.length, 0)
})

test('reorders by symbol without confusing prices or replacing unrelated positions', () => {
  const source = initialAccount(0).watchlists[0].symbols
  assert.deepEqual(reorder(source, 'RELIANCE', 'INFY'), ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ICICIBANK'])
  assert.equal(reorder(source, 'SBIN', 'INFY'), source)
  assert.equal(source[0], 'RELIANCE')
})

test('detects a crossing from the opposite side, including landing on the threshold', () => {
  assert.equal(crossed('above', 200, 199, 200), true)
  assert.equal(crossed('below', 200, 201, 199), true)
  assert.equal(crossed('above', 200, 200, 201), false)
  assert.equal(crossed('below', 200, 199, 198), false)
  assert.equal(crossed('above', 200, 198, 199), false)
})

test('produces a shared clock-driven stream at over 50 changing ticks per second', () => {
  const first = new MarketFeed(0, 0)
  let ticks = 0
  let notifications = 0
  const initialTcs = first.quote('TCS')
  const stop = first.subscribe('TCS', () => notifications++)
  first.subscribeTicks(batch => { ticks += batch.length })
  for (let ms = 20; ms <= 10_000; ms += 20) first.advance(ms)
  assert.ok(ticks >= 500 && ticks <= 10 * TICKS_PER_SECOND, `changing ticks: ${ticks}`)
  assert.ok(notifications >= 50 && notifications <= 60)
  assert.notEqual(first.quote('TCS'), initialTcs)
  const second = new MarketFeed(0, 10_000)
  for (const symbol of ['RELIANCE', 'TCS', 'INFY', 'AXISBANK'] as const) {
    assert.equal(first.quote(symbol).price, second.quote(symbol).price)
    assert.equal(first.quote(symbol).price, second.currentPrice(symbol, 10_000))
  }
  const history = first.history('RELIANCE', 60, 100, first.quote('RELIANCE').index)
  assert.equal(history.at(-1)?.price, first.quote('RELIANCE').price)
  stop()
  const stoppedAt = notifications
  first.advance(70_000)
  assert.equal(notifications, stoppedAt)
  assert.equal(first.quote('TCS').price, first.currentPrice('TCS', 70_000))
})

test('chart history retains completed samples as the live endpoint advances', () => {
  const feed = new MarketFeed(0, 0)
  for (const seconds of [60, 300, 900]) {
    const before = feed.history('TCS', seconds, 100, 11)
    for (const end of [21, 611]) {
      const after = feed.history('TCS', seconds, 100, end)
      const overlap = before.slice(1, -1).filter(point => point.time > after[0].time)
      assert.ok(overlap.length > 50)
      assert.deepEqual(after.filter(point => point.time >= overlap[0].time && point.time <= overlap.at(-1)!.time), overlap)
      assert.equal(after.at(-1)?.price, priceAt(1, end))
    }
  }
})
