import { initialAccount } from './domain.ts'
import type { Account } from './domain.ts'

export type Mutation = (account: Account) => Account
const DATABASE = '021-trade'
const STORE = 'workspace'
const ACCOUNT_KEY = 'account'
const CHANNEL = '021-trade:commits'

export class AccountStore {
  private database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  private channel = new BroadcastChannel(CHANNEL)
  private state: Account | null = null
  private listeners = new Set<() => void>()

  constructor(private onSyncError: (error: unknown) => void) {
    this.channel.onmessage = this.refresh
    window.addEventListener('focus', this.refresh)
    document.addEventListener('visibilitychange', this.refresh)
  }

  private refresh = () => { void this.read().catch(this.onSyncError) }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(account: Account) {
    if (this.state && this.state.revision >= account.revision) return
    this.state = account
    this.listeners.forEach(listener => listener())
  }

  async read() {
    const db = await this.database
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(ACCOUNT_KEY)
      request.onsuccess = () => {
        if (request.result) this.publish(request.result as Account)
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }

  async mutate(mutation: Mutation): Promise<Account> {
    const db = await this.database
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.get(ACCOUNT_KEY)
      let next: Account
      let changed = false
      let failure: unknown

      request.onsuccess = () => {
        const saved = request.result as Account | undefined
        const current = saved ?? initialAccount()
        try {
          next = mutation(current)
          changed = !saved || next !== current
          if (changed) {
            next = { ...next, revision: current.revision + 1 }
            store.put(next, ACCOUNT_KEY)
          }
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
      transaction.oncomplete = () => {
        this.publish(next)
        if (changed) this.channel.postMessage(next.revision)
        resolve(next)
      }
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('The change was not saved. Try again.'))
    })
  }
}
