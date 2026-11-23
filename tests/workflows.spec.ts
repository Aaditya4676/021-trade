import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { holdingValue, money, percent, STARTING_CASH, STOCKS } from '../src/domain.ts'
import type { Account } from '../src/domain.ts'
import { priceAt, TICKS_PER_SECOND } from '../src/market.ts'

const time = new Date('2026-11-23T05:00:00Z')

async function freeze(page: Page) {
  await page.clock.install({ time })
  await page.clock.pauseAt(new Date(time.getTime() + 1000))
}

async function readAccount(page: Page): Promise<Account> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('021-trade', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = open.result.transaction('workspace').objectStore('workspace').get('account')
      request.onsuccess = () => { resolve(request.result); open.result.close() }
      request.onerror = () => { reject(request.error); open.result.close() }
    }
  }))
}

test('manages watchlists, reorders with drag and keyboard, and synchronizes another tab', async ({ page, context }) => {
  await freeze(page)
  await page.goto('/')
  const second = await context.newPage()
  await freeze(second)
  await second.goto('/')
  const a = page.getByRole('complementary', { name: 'Watchlists' })
  const b = second.getByRole('complementary', { name: 'Watchlists' })
  await a.getByRole('button', { name: 'New watchlist' }).click()
  await page.getByRole('textbox', { name: 'Watchlist name' }).fill('Momentum')
  await page.getByRole('button', { name: 'Create watchlist' }).click()
  await expect(a.getByText('No stocks yet')).toBeVisible()
  await expect(b.getByRole('option', { name: 'Momentum' })).toHaveCount(1)
  await b.getByLabel('Active watchlist').selectOption({ label: 'Momentum' })

  await a.getByRole('button', { name: 'Add stocks' }).click()
  const picker = page.getByRole('dialog')
  await expect(picker.getByRole('listitem')).toHaveCount(10)
  await picker.getByRole('button', { name: 'Add RELIANCE' }).click()
  await picker.getByRole('button', { name: 'Add INFY' }).click()
  await picker.getByRole('textbox', { name: 'Find a stock' }).fill('axis')
  await picker.getByRole('button', { name: 'Add AXISBANK' }).click()
  await picker.getByRole('button', { name: 'Done' }).click()
  await expect(b.getByRole('button', { name: 'Trade AXISBANK from watchlist' })).toBeVisible()
  const handle = a.getByRole('button', { name: 'Reorder RELIANCE' })
  await handle.focus()
  await handle.press('Space')
  await handle.press('ArrowDown')
  await handle.press('Space')
  await expect(a.locator('.watch-symbol')).toHaveText(['INFY', 'RELIANCE', 'AXISBANK'])
  await a.getByRole('button', { name: 'Reorder AXISBANK' }).dragTo(a.getByRole('button', { name: 'Trade INFY from watchlist' }))
  await expect(b.locator('.watch-symbol')).toHaveText(['AXISBANK', 'INFY', 'RELIANCE'])

  const stock = 'INFY'
  const watchPrice = await a.getByRole('button', { name: `Trade ${stock} from watchlist` }).locator('.watch-price').innerText()
  const marketPrice = await page.getByRole('row').filter({ has: page.getByRole('button', { name: `Trade ${stock} from market` }) }).locator('td').nth(1).innerText()
  expect(`₹${watchPrice}`).toBe(marketPrice)
  await a.getByRole('button', { name: `Trade ${stock} from watchlist` }).click()
  await expect(page.locator('#trade-ticket').getByLabel('Stock')).toHaveValue(stock)
  await a.getByRole('button', { name: 'Remove AXISBANK' }).click()
  await a.getByRole('button', { name: 'Rename watchlist' }).click()
  await page.getByRole('textbox', { name: 'Watchlist name' }).fill('Long-term')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(b.locator('.watch-symbol')).toHaveText(['INFY', 'RELIANCE'])
  await second.reload()
  await b.getByLabel('Active watchlist').selectOption({ label: 'Long-term' })
  await expect(b.locator('.watch-symbol')).toHaveText(['INFY', 'RELIANCE'])
  await b.getByRole('button', { name: 'Delete watchlist' }).click()
  await second.getByRole('dialog').getByRole('button', { name: 'Delete watchlist' }).click()
  await expect(a.getByRole('option', { name: 'Long-term' })).toHaveCount(0)
})

test('validates orders, fills once at submit price, tracks holdings, and persists the ledger', async ({ page }) => {
  await freeze(page)
  await page.goto('/')
  const ticket = page.locator('#trade-ticket')
  const quantity = ticket.getByLabel('Quantity', { exact: true })
  const buy = ticket.getByRole('button', { name: 'Buy RELIANCE' })
  for (const input of ['', '0', '-1', '1.5']) {
    await quantity.fill(input)
    await expect(ticket.getByRole('alert')).toHaveText('Enter a positive whole number of shares.')
    await expect(buy).toBeDisabled()
  }
  await quantity.fill('10000')
  await expect(ticket.getByRole('alert')).toContainText('Insufficient buying power')
  await expect(buy).toBeDisabled()
  await quantity.fill('3')
  const oldValue = await ticket.locator('.estimated dd').innerText()
  await page.clock.runFor(500)
  await expect(ticket.locator('.estimated dd')).not.toHaveText(oldValue)
  const expectedFill = await ticket.locator('.ticket-breakdown div').first().locator('dd').innerText()
  await buy.dblclick()
  await expect(ticket.getByRole('heading', { name: 'Order filled' })).toBeFocused()
  await expect(ticket.locator('.receipt dd').first()).toHaveText(expectedFill)
  const bought = await readAccount(page)
  expect(bought.orders).toHaveLength(1)
  expect(bought.cash).toBe(STARTING_CASH - bought.orders[0].value)
  await page.getByRole('link', { name: 'Holdings' }).click()
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Trade RELIANCE from holdings' }) })
  await expect(row.locator('td').nth(1)).toHaveText('3')
  await expect(page.locator('.portfolio-summary dd').first()).toHaveText(money(bought.orders[0].value))
  const before = await row.locator('td').last().innerText()
  await page.clock.runFor(1000)
  await expect(row.locator('td').last()).not.toHaveText(before)
  await page.getByRole('button', { name: 'Current value' }).click()
  await expect(page.getByRole('columnheader', { name: 'Current value' })).toHaveAttribute('aria-sort', 'descending')
  await row.getByRole('button', { name: 'Trade RELIANCE from holdings' }).click()
  await ticket.getByRole('button', { name: 'Sell', exact: true }).click()
  await quantity.fill('4')
  await expect(ticket.getByRole('alert')).toHaveText('You can sell up to 3 shares.')
  await expect(ticket.getByText('Estimated P&L')).toHaveCount(0)
  await quantity.fill('3')
  await expect(ticket.getByText('Average buy price').locator('..').locator('dd')).toHaveText(money(bought.orders[0].price))
  const position = bought.holdings.RELIANCE!
  function pnlAt(price: number) {
    const { pnl, rate } = holdingValue(position, price)
    return `${money(pnl, { signed: true })} (${percent(rate)})`
  }
  const displayedPrice = await ticket.getByText('Live price', { exact: true }).locator('..').locator('dd').innerText()
  await expect(ticket.getByText('Estimated P&L').locator('..').locator('dd')).toHaveText(pnlAt(Number(displayedPrice.replace(/\D/g, ''))))
  await ticket.getByRole('button', { name: 'Sell RELIANCE' }).click()
  await expect(ticket.getByRole('heading', { name: 'Order filled' })).toBeVisible()
  const sale = (await readAccount(page)).orders[0]
  await expect(ticket.getByText('Realized P&L').locator('..').locator('dd')).toHaveText(pnlAt(sale.price))
  await expect(ticket.getByText('Cost of shares sold').locator('..').locator('dd')).toHaveText(money(bought.orders[0].value))
  await expect(page.getByRole('heading', { name: 'No open positions' })).toBeVisible()
  await ticket.getByRole('button', { name: 'View order history' }).click()
  await page.reload()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('tbody tr').first()).toContainText('Sell')
  const sold = await readAccount(page)
  expect(sold.holdings).toEqual({})
  expect(sold.cash).toBe(STARTING_CASH - sold.orders[1].value + sold.orders[0].value)
  await expect(page.locator('.cash-pill dd')).toHaveText(money(sold.cash))
})

test('serializes competing orders from two tabs against the same balance', async ({ page, context }) => {
  await freeze(page)
  await page.goto('/')
  const second = await context.newPage()
  await freeze(second)
  await second.goto('/')
  const price = priceAt(0, 0)
  const quantity = String(Math.floor(Number(STARTING_CASH) * 0.7 / price))
  await page.getByLabel('Quantity', { exact: true }).fill(quantity)
  await second.getByLabel('Quantity', { exact: true }).fill(quantity)
  const submit = (tab: Page) => tab.getByRole('button', { name: 'Buy RELIANCE' }).dispatchEvent('click')
  await Promise.all([submit(page), submit(second)])
  await expect.poll(async () => (await readAccount(page)).orders.length).toBe(1)
  await expect.poll(async () => (await page.getByRole('heading', { name: 'Order filled' }).count()) + (await second.getByRole('heading', { name: 'Order filled' }).count())).toBe(1)
  await expect.poll(async () => (await page.getByText('Insufficient buying power', { exact: false }).count()) + (await second.getByText('Insufficient buying power', { exact: false }).count())).toBe(1)
  const account = await readAccount(page)
  expect(account.cash).toBe(STARTING_CASH - account.orders[0].value)
  for (const tab of [page, second]) await expect(tab.locator('.cash-pill dd')).toHaveText(money(account.cash))
  const losingTab = await page.locator('.receipt').count() ? second : page
  const ticket = losingTab.locator('#trade-ticket')
  await ticket.getByLabel('Stock').selectOption('ITC')
  await expect(ticket.getByRole('alert')).toHaveCount(0)
  await expect(ticket.getByText(/declined/)).toHaveCount(0)
  await ticket.getByRole('button', { name: 'Buy ITC' }).click()
  await expect(ticket.getByRole('heading', { name: 'Order filled' })).toBeVisible()
  expect((await readAccount(losingTab)).orders).toHaveLength(2)
})

test('fires simultaneous alerts once across tabs, suppresses deleted alerts, and persists triggered state', async ({ page, context }) => {
  await freeze(page)
  await page.goto('/#alerts')
  await expect(page.getByRole('heading', { name: 'Price alerts' })).toBeVisible()
  const target = page.getByLabel('Target price (₹)')
  const create = page.getByRole('button', { name: 'Set price alert' })
  await target.fill('0.001')
  await create.click()
  await expect(page.getByRole('alert')).toContainText('up to two decimal places')

  const signs = { above: 1, below: -1 } as const
  const crossings = Object.entries(signs).map(([direction, sign]) => {
    let index = 30
    while (Math.sign(priceAt(0, index) - priceAt(0, index - STOCKS.length)) !== sign) index += STOCKS.length
    return { direction, index, price: priceAt(0, index) }
  })
  const [above, below] = crossings
  async function add(price: number) {
    await target.fill((price / 100).toFixed(2))
    await create.click()
    await expect(target).toHaveValue('')
  }
  await add(above.price)
  await add(above.price)
  await page.getByRole('button', { name: 'Crosses below', exact: true }).click()
  await add(below.price)
  await add(below.price)
  await page.getByRole('button', { name: /Delete RELIANCE below/ }).first().click()
  await expect(page.getByRole('region', { name: 'Active alerts' }).getByRole('listitem')).toHaveCount(3)
  const second = await context.newPage()
  await freeze(second)
  await second.goto('/#alerts')
  await expect(second.getByRole('region', { name: 'Active alerts' }).getByRole('listitem')).toHaveCount(3)
  const ms = Math.ceil(Math.max(above.index, below.index) * 1000 / TICKS_PER_SECOND) + 30
  const totalToasts = async () => (await page.locator('.toast-stack .toast').count()) + (await second.locator('.toast-stack .toast').count())
  await Promise.all([page.clock.runFor(ms), second.clock.runFor(ms)])
  await expect.poll(totalToasts).toBe(3)
  for (const tab of [page, second]) await expect(tab.getByRole('region', { name: 'Triggered alerts' }).getByRole('listitem')).toHaveCount(3)
  await Promise.all([page.clock.runFor(3500), second.clock.runFor(3500)])
  await expect.poll(totalToasts).toBe(3)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Triggered alerts' }).getByRole('listitem')).toHaveCount(3)
  await page.clock.runFor(1500)
  await expect(page.locator('.toast-stack .toast')).toHaveCount(0)
})

test('values and re-sorts ten held stocks after the feed catches up', async ({ page }) => {
  await freeze(page)
  await page.goto('/')
  const ticket = page.locator('#trade-ticket')
  for (const stock of STOCKS) {
    await page.getByRole('button', { name: `Trade ${stock.symbol} from market` }).click()
    await ticket.getByRole('button', { name: `Buy ${stock.symbol}` }).click()
    await expect(ticket.getByRole('heading', { name: 'Order filled' })).toBeVisible()
  }
  await page.getByRole('link', { name: 'Holdings' }).click()
  await expect(page.getByRole('columnheader', { name: 'P&L' })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.locator('tbody tr')).toHaveCount(10)
  const account = await readAccount(page)
  await page.clock.fastForward(6000)
  const now = await page.evaluate(() => Date.now())
  const index = Math.floor((now - account.marketEpoch) / (1000 / TICKS_PER_SECOND))
  const expected = STOCKS.map((stock, position) => ({ symbol: stock.symbol, ...holdingValue(account.holdings[stock.symbol]!, priceAt(position, index)) }))
  expected.sort((a, b) => a.pnl === b.pnl ? a.symbol.localeCompare(b.symbol) : a.pnl > b.pnl ? -1 : 1)
  await expect(page.locator('tbody .table-symbol strong')).toHaveText(expected.map(row => row.symbol))
  await expect(page.locator('.portfolio-summary dd').nth(1)).toHaveText(money(expected.reduce((sum, row) => sum + row.value, 0n)))
  await expect(page.locator('.portfolio-summary dd').nth(2)).toContainText(money(expected.reduce((sum, row) => sum + row.pnl, 0n), { signed: true }))
  await page.getByRole('button', { name: 'Symbol', exact: true }).click()
  await expect(page.locator('tbody .table-symbol strong')).toHaveText(STOCKS.map(stock => stock.symbol).sort())
})

test('streams ten instruments smoothly while scrolling and fits a narrow viewport', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.market-panel tbody tr')).toHaveCount(10)
  const performance = await page.evaluate(() => new Promise<{ changes: number; p95: number }>(resolve => {
    const prices = [...document.querySelectorAll('.market-panel tbody .flash')]
    let changes = 0
    const observer = new MutationObserver(records => { changes += records.length })
    for (const element of prices) observer.observe(element, { subtree: true, characterData: true })
    const gaps: number[] = []
    let previous: number | undefined
    let start: number | undefined
    let frames = 0
    function sample(now: number) {
      start ??= now
      if (previous !== undefined) gaps.push(now - previous)
      previous = now
      if (now - start >= 4000) {
        observer.disconnect()
        gaps.sort((a, b) => a - b)
        resolve({ changes, p95: gaps[Math.floor(gaps.length * .95)] })
        return
      }
      if (++frames % 6 === 0) window.scrollTo(0, (frames * 17) % 450)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  console.log(`Market scrolling sample: ${performance.changes} LTP updates in 4s, p95 frame interval ${performance.p95.toFixed(1)} ms`)
  expect(performance.changes).toBeGreaterThanOrEqual(200)
  expect(performance.p95).toBeLessThan(55)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Trade INFY from watchlist' }).click()
  await expect(page.locator('#trade-ticket').getByLabel('Stock')).toHaveValue('INFY')
  await expect(page.getByRole('heading', { name: 'Order ticket' })).toBeInViewport()
})

test('closes dialogs whose watchlist is deleted in another tab', async ({ page, context }) => {
  await page.goto('/')
  const other = await context.newPage()
  await other.goto('/')
  const original = (await readAccount(page)).watchlists
  for (const action of ['Rename watchlist', 'Add stocks', 'Delete watchlist']) {
    await page.getByRole('button', { name: 'New watchlist' }).click()
    await page.getByLabel('Watchlist name').fill('Banks')
    await page.getByRole('button', { name: 'Create watchlist' }).click()
    await expect(page.getByText('No stocks yet')).toBeVisible()
    await other.getByLabel('Active watchlist').selectOption({ label: 'Banks' })
    await page.getByRole('button', { name: action }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await other.getByRole('button', { name: 'Delete watchlist' }).click()
    await other.getByRole('dialog').getByRole('button', { name: 'Delete watchlist' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveText('This watchlist was deleted in another tab.')
    expect((await readAccount(page)).watchlists).toEqual(original)
    await expect(other.getByRole('alert')).toHaveCount(0)
  }
})

test.describe('touch watchlist', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('reorders by tap and keeps keyboard navigation inside the opened ticket', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Reorder RELIANCE' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Reorder stock' })
    await expect(dialog.getByRole('button', { name: 'Move up' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Move down' }).tap()
    await expect(dialog.getByRole('status')).toContainText('Position 2 of 5')
    await dialog.getByRole('button', { name: 'Move up' }).tap()
    await expect(dialog.getByRole('status')).toContainText('Position 1 of 5')
    await dialog.getByRole('button', { name: 'Move down' }).tap()
    await dialog.getByRole('button', { name: 'Done' }).tap()
    await page.reload()
    await expect(page.locator('.watch-symbol')).toHaveText(['TCS', 'RELIANCE', 'INFY', 'HDFCBANK', 'ICICIBANK'])
    await page.getByRole('button', { name: 'Trade INFY from watchlist' }).press('Enter')
    const ticket = page.locator('#trade-ticket')
    await expect(ticket.getByRole('heading', { name: 'Order ticket' })).toBeFocused()
    await expect(ticket.getByLabel('Stock')).toHaveValue('INFY')
    await page.keyboard.press('Tab')
    await expect(ticket.getByRole('button', { name: 'Buy', exact: true })).toBeFocused()
  })
})

test('remembers the theme and keeps header and live quote columns stable', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Dark mode' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const second = await context.newPage()
  await second.goto('/')
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.focus()
  await toggle.press('Space')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => document.fonts.ready)
  const widths = await page.locator('.market-panel tbody tr').first().evaluate(row => {
    const price = row.querySelector('.flash')!
    const measure = () => [...row.querySelectorAll('td')].map(cell => cell.getBoundingClientRect().width)
    price.textContent = '₹999.99'
    const before = measure()
    price.textContent = '₹10,000.00'
    return [before, measure()]
  })
  expect(widths[0]).toEqual(widths[1])
  const nav = page.getByRole('navigation', { name: 'Workspace' })
  const bounds = await nav.boundingBox()
  for (const name of ['Holdings', 'Orders', 'Alerts']) {
    await nav.getByRole('link', { name }).click()
    await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
    expect(await nav.boundingBox()).toEqual(bounds)
  }
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})
