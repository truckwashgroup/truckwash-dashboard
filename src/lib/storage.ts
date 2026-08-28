import { Capacitor } from '@capacitor/core'

/**
 * Kleine sleutel/waarde-opslag. Op iOS/Android via Capacitor Preferences
 * (overleeft het opschonen van de webview-cache), op Windows/web via
 * localStorage.
 */

const native = Capacitor.isNativePlatform()

let prefs: typeof import('@capacitor/preferences').Preferences | null = null

async function getPrefs() {
  if (!native) return null
  if (!prefs) prefs = (await import('@capacitor/preferences')).Preferences
  return prefs
}

export async function storageGet(key: string): Promise<string | null> {
  const p = await getPrefs()
  if (p) return (await p.get({ key })).value
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export async function storageSet(key: string, value: string) {
  const p = await getPrefs()
  if (p) return void p.set({ key, value })
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota / private mode */
  }
}

export async function storageRemove(key: string) {
  const p = await getPrefs()
  if (p) return void p.remove({ key })
  try {
    localStorage.removeItem(key)
  } catch {
    /* noop */
  }
}
