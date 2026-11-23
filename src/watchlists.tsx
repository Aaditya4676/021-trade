import { memo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Check, ChevronDown, GripVertical, ListFilter, ListPlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { money, percent, reorder, STOCKS } from './domain.ts'
import type { Account, Symbol, Watchlist } from './domain.ts'
import type { MarketFeed } from './market.ts'
import type { AccountStore } from './storage.ts'
import { Dialog, failureMessage, Flash, tone, useQuote } from './ui.tsx'
import type { OpenTicket } from './ui.tsx'

const WatchPrice = memo(function WatchPrice({ feed, symbol }: { feed: MarketFeed; symbol: Symbol }) {
  const quote = useQuote(feed, symbol)
  return <>
    <span className="watch-price"><Flash quote={quote}>{money(quote.price, { currency: false })}</Flash></span>
    <span className={`watch-change ${tone(quote.change)}`}>
      <span>{money(quote.change, { signed: true, currency: false })}</span><span>{percent(quote.rate)}</span>
    </span>
  </>
})

type ListDialog =
  | { mode: 'create' }
  | { mode: 'rename' | 'delete' | 'picker'; listId: string }
  | { mode: 'reorder'; listId: string; symbol: Symbol }

const deletedMessage = 'This watchlist was deleted in another tab.'

export function Watchlists({ account, store, feed, openTicket, selected }: {
  account: Account; store: AccountStore; feed: MarketFeed; openTicket: OpenTicket; selected: Symbol
}) {
  const [activeId, setActiveId] = useState('core')
  const [dialog, setDialog] = useState<ListDialog | null>(null)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<Symbol | null>(null)
  const [dropTarget, setDropTarget] = useState<Symbol | null>(null)
  const [keyboard, setKeyboard] = useState<{ source: Symbol; target: Symbol } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const active = account.watchlists.find(list => list.id === activeId) ?? account.watchlists[0]

  const dialogList = dialog && dialog.mode !== 'create'
    ? account.watchlists.find(list => list.id === dialog.listId)
    : undefined
  const position = dialog?.mode === 'reorder' ? dialogList?.symbols.indexOf(dialog.symbol) ?? -1 : -1

  // Resolve a deleted selection before a gesture can continue on the fallback list.
  if (activeId !== (active?.id ?? '')) changeList(active?.id ?? '')

  // A remote commit may remove the target while a modal is open.
  if (dialog && dialog.mode !== 'create' && !dialogList) {
    setDialog(null)
    if (!(dialog.mode === 'delete' && busy)) setError(deletedMessage)
  } else if (dialog?.mode === 'reorder' && position < 0) {
    setDialog(null)
    setError('This stock was removed from the watchlist.')
  }

  function changeList(id: string) {
    setActiveId(id)
    setDragging(null)
    setDropTarget(null)
    setKeyboard(null)
    setError('')
  }

  function openDialog(mode: 'create' | 'rename' | 'delete' | 'picker') {
    setError('')
    setQuery('')
    setName(mode === 'rename' ? active?.name ?? '' : '')
    if (mode === 'create') setDialog({ mode })
    else if (active) setDialog({ mode, listId: active.id })
  }

  async function updateList(id: string, update: (list: Watchlist) => Watchlist) {
    setError('')
    try {
      await store.mutate(current => {
        const list = current.watchlists.find(item => item.id === id)
        if (!list) throw new Error(deletedMessage)
        const next = update(list)
        if (list === next) return current
        return { ...current, watchlists: current.watchlists.map(item => item.id === id ? next : item) }
      })
    } catch (error) { setError(failureMessage(error)) }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) { setError('Enter a name for this watchlist.'); return }
    if (dialog?.mode !== 'rename' && dialog?.mode !== 'create') return
    const id = dialog.mode === 'create' ? crypto.randomUUID() : dialog.listId
    setBusy(true)
    try {
      await store.mutate(current => {
        if (current.watchlists.some(item => item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase())) {
          throw new Error('A watchlist with that name already exists.')
        }
        if (dialog.mode === 'create') return { ...current, watchlists: [...current.watchlists, { id, name: trimmed, symbols: [] }] }
        if (!current.watchlists.some(item => item.id === id)) throw new Error(deletedMessage)
        return { ...current, watchlists: current.watchlists.map(item => item.id === id ? { ...item, name: trimmed } : item) }
      })
      changeList(id)
      setDialog(null)
    } catch (error) { setError(failureMessage(error)) }
    finally { setBusy(false) }
  }

  async function deleteList() {
    if (dialog?.mode !== 'delete' || busy) return
    setBusy(true)
    try {
      await store.mutate(current => {
        if (!current.watchlists.some(list => list.id === dialog.listId)) throw new Error(deletedMessage)
        return { ...current, watchlists: current.watchlists.filter(list => list.id !== dialog.listId) }
      })
      setDialog(null)
    } catch (error) { setError(failureMessage(error)) }
    finally { setBusy(false) }
  }

  function move(source: Symbol, destination: Symbol) {
    if (!active || source === destination) return
    void updateList(active.id, list => {
      const symbols = reorder(list.symbols, source, destination)
      return symbols === list.symbols ? list : { ...list, symbols }
    })
  }

  function moveOneStep(offset: -1 | 1) {
    if (dialog?.mode !== 'reorder') return
    void updateList(dialog.listId, list => {
      const from = list.symbols.indexOf(dialog.symbol)
      const destination = list.symbols[from + offset]
      if (from < 0 || !destination) return list
      return { ...list, symbols: reorder(list.symbols, dialog.symbol, destination) }
    })
  }

  function reorderKey(event: KeyboardEvent<HTMLButtonElement>, symbol: Symbol) {
    if (!active || ![' ', 'Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return
    if (!keyboard && event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (event.key === 'Escape') {
      setKeyboard(null)
      setAnnouncement('Reordering cancelled.')
    } else if (event.key === ' ' || event.key === 'Enter') {
      if (keyboard?.source === symbol) {
        move(symbol, keyboard.target)
        setKeyboard(null)
        setAnnouncement(`${symbol} moved to position ${active.symbols.indexOf(keyboard.target) + 1}.`)
      } else {
        setKeyboard({ source: symbol, target: symbol })
        setAnnouncement(`${symbol} picked up. Use arrow keys to move, then press Space to drop.`)
      }
    } else if (keyboard?.source === symbol) {
      const position = active.symbols.indexOf(keyboard.target)
      const next = Math.max(0, Math.min(active.symbols.length - 1, position + (event.key === 'ArrowUp' ? -1 : 1)))
      setKeyboard({ source: symbol, target: active.symbols[next] })
      setAnnouncement(`Position ${next + 1} of ${active.symbols.length}.`)
    }
  }

  return <aside className="panel watch-panel" aria-label="Watchlists">
    <div className="panel-title watch-heading"><h2><ListFilter size={18} /> Watchlists</h2><button className="icon-button" type="button" title="New watchlist" aria-label="New watchlist" onClick={() => openDialog('create')}><Plus size={18} /></button></div>
    {active && <>
      <div className="watch-controls">
        <label className="select-wrap"><span className="sr-only">Active watchlist</span><select value={active.id} onChange={event => changeList(event.target.value)}>
          {account.watchlists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select><ChevronDown size={15} /></label>
        <button type="button" className="icon-button" title="Rename watchlist" aria-label="Rename watchlist" onClick={() => openDialog('rename')}><Pencil size={15} /></button>
        <button type="button" className="icon-button" title="Delete watchlist" aria-label="Delete watchlist" onClick={() => openDialog('delete')}><Trash2 size={15} /></button>
      </div>
      <div className="watch-caption"><span>{active.symbols.length} {active.symbols.length === 1 ? 'stock' : 'stocks'}</span><span>Last price</span><span>Change / %</span></div>
      <ul className="watch-rows" aria-label={active.name}>
        {active.symbols.map(symbol => <li key={symbol}
          className={`watch-row${selected === symbol ? ' selected' : ''}${(dropTarget === symbol && dragging !== symbol) || (keyboard?.target === symbol && keyboard.source !== symbol) ? ' drag-target' : ''}`}
          onDragOver={event => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(symbol) } }}
          onDrop={event => { event.preventDefault(); if (dragging) move(dragging, symbol); setDragging(null); setDropTarget(null) }}>
          <button className="grip" type="button" draggable aria-label={`Reorder ${symbol}`} title="Tap for move options, drag, or press Space then use arrow keys" aria-pressed={keyboard?.source === symbol}
            onClick={() => { setError(''); setDialog({ mode: 'reorder', listId: active.id, symbol }) }}
            onKeyDown={event => reorderKey(event, symbol)} onBlur={() => setKeyboard(null)}
            onDragStart={event => { event.dataTransfer.setData('text/plain', symbol); event.dataTransfer.effectAllowed = 'move'; setDragging(symbol) }}
            onDragEnd={() => { setDragging(null); setDropTarget(null) }}><GripVertical size={14} /></button>
          <button className="watch-quote" type="button" aria-label={`Trade ${symbol} from watchlist`} onClick={() => openTicket(symbol)}>
            <span className="watch-symbol">{symbol}</span><WatchPrice symbol={symbol} feed={feed} />
          </button>
          <button className="remove-stock" type="button" title={`Remove ${symbol}`} aria-label={`Remove ${symbol}`} onClick={() => void updateList(active.id, list => ({ ...list, symbols: list.symbols.filter(item => item !== symbol) }))}><X size={13} /></button>
        </li>)}
      </ul>
      {!active.symbols.length && <div className="watch-empty"><ListPlus size={24} /><strong>No stocks yet</strong><span>Add a stock to track its live price.</span></div>}
    </>}
    {!active && <div className="watch-empty"><ListPlus size={24} /><strong>No watchlists yet</strong><span>Create a list to follow your stocks.</span></div>}
    {error && !dialog && <p className="inline-error watch-error" role="alert">{error}</p>}
    <div className="watch-footer"><button type="button" className="button secondary full" onClick={() => openDialog(active ? 'picker' : 'create')}><Plus size={16} />{active ? 'Add stocks' : 'Create watchlist'}</button></div>
    <span className="sr-only" role="status">{announcement}</span>

    {dialog && <Dialog title={{ create: 'New watchlist', rename: 'Rename watchlist', delete: 'Delete watchlist', picker: 'Add stocks', reorder: 'Reorder stock' }[dialog.mode]} close={() => { setDialog(null); setError('') }}>
      {(dialog.mode === 'create' || dialog.mode === 'rename') && <form className="dialog-form" onSubmit={saveName}>
        <label className="field">Watchlist name<input autoFocus value={name} maxLength={32} onChange={event => setName(event.target.value)} placeholder="e.g. Long-term ideas" /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy}>{dialog.mode === 'create' ? 'Create watchlist' : 'Save name'}</button>
      </form>}
      {dialog.mode === 'delete' && <div className="dialog-form">
        <p>Delete <strong>{dialogList?.name}</strong> and its stock list?</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDialog(null)}>Cancel</button><button type="button" className="button danger" disabled={busy} onClick={() => void deleteList()}>Delete watchlist</button></div>
      </div>}
      {dialog.mode === 'reorder' && dialogList && <div className="dialog-form">
        <p role="status"><strong>{dialog.symbol}</strong> · Position {position + 1} of {dialogList.symbols.length}</p>
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={position <= 0} onClick={() => moveOneStep(-1)}>Move up</button>
          <button type="button" className="button secondary" disabled={position >= dialogList.symbols.length - 1} onClick={() => moveOneStep(1)}>Move down</button>
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button type="button" className="button primary full" onClick={() => setDialog(null)}>Done</button>
      </div>}
      {dialog.mode === 'picker' && dialogList && <div className="dialog-form picker">
        <label className="search-wrap"><Search size={17} /><input autoFocus aria-label="Find a stock" placeholder="Search symbol or company" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <ul className="picker-list">
          {STOCKS.filter(stock => `${stock.symbol} ${stock.name}`.toLowerCase().includes(query.trim().toLowerCase())).map(stock => {
            const added = dialogList.symbols.includes(stock.symbol)
            return <li key={stock.symbol}><div><strong>{stock.symbol}</strong><span>{stock.name}</span></div><button type="button" className="icon-button" disabled={added} aria-label={added ? `${stock.symbol} already added` : `Add ${stock.symbol}`} onClick={() => void updateList(dialogList.id, list => list.symbols.includes(stock.symbol) ? list : { ...list, symbols: [...list.symbols, stock.symbol] })}>{added ? <Check size={17} /> : <Plus size={17} />}</button></li>
          })}
        </ul>
        {!STOCKS.some(stock => `${stock.symbol} ${stock.name}`.toLowerCase().includes(query.trim().toLowerCase())) && <p className="muted">No stocks match your search.</p>}
        <button type="button" className="button primary full" onClick={() => setDialog(null)}>Done</button>
      </div>}
    </Dialog>}
  </aside>
}
