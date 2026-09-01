import { create } from 'zustand'
import { Capacitor } from '@capacitor/core'
import { ApkUpdater, kijkOfErEenUpdateIs, type Beschikbaar } from './apkUpdate'

/* ------------------------------------------------------------------ *
 *  Automatische updates, per platform
 *
 *  Windows  : Electron + electron-updater. Controleert bij start en elk
 *             half uur, downloadt op de achtergrond en installeert bij
 *             het afsluiten (of direct via de knop).
 *  Android  : Dezelfde release als Windows, andere weg. De app vraagt GitHub
 *             welke versie de laatste is, haalt de APK op en geeft die aan
 *             Android om te installeren. Zie apkUpdate.ts en ApkUpdater.java.
 *
 *             Waarom niet OTA (alleen de webbundel verversen): dat komt niet
 *             bij wijzigingen aan de native kant, en het vraagt een tweede
 *             plek om bundels te hosten. Eén release voor alles is minder om
 *             uit elkaar te laten lopen.
 *  Web      : de nieuwste build staat er bij een herlaadactie.
 * ------------------------------------------------------------------ */

export type UpdateState =
  | 'idle' | 'checking' | 'up-to-date' | 'available'
  | 'downloading' | 'ready' | 'error'

/**
 * Het venster bedienen.
 *
 * Staat als optioneel in de brug: een oudere geïnstalleerde app heeft deze
 * nog niet, en die hoort niet om te vallen op een titelbalk.
 */
export interface VensterBrug {
  minimaliseren(): Promise<void>
  maximaliseren(): Promise<void>
  sluiten(): Promise<void>
  isMax(): Promise<boolean>
  onMax(cb: (max: boolean) => void): () => void
}

interface DesktopBridge {
  platform: string
  isElectron: true
  getVersion(): Promise<string>
  checkForUpdates(): Promise<{ ok: boolean; reason?: string }>
  installUpdate(): Promise<void>
  notify?(title: string, body: string): Promise<boolean>
  onUpdateStatus(cb: (p: any) => void): () => void
  venster?: VensterBrug
}

declare global {
  interface Window { desktop?: DesktopBridge }
}

interface UpdateStore {
  channel: 'windows' | 'mobile' | 'web'
  state: UpdateState
  version: string
  newVersion: string | null
  percent: number
  message: string | null
  /**
   * Op Android: of deze app een installatie mag starten. Staat standaard uit
   * en is een instelling per app, dus we vragen het en zeggen het erbij.
   */
  magInstalleren: boolean
  /** Het gedownloade bestand, klaar om te installeren. */
  bestand: string | null
  init: () => Promise<void>
  check: () => Promise<void>
  install: () => Promise<void>
  /** Android: de systeeminstelling openen waar de gebruiker het toestaat. */
  toestemmingVragen: () => Promise<void>
}

/**
 * De versie komt uit package.json, ingebakken tijdens het bouwen (zie
 * vite.config.ts).
 *
 * Hier stond '1.0.0' als vaste tekst, terwijl package.json al veel verder
 * was. Op Windows viel dat niet op omdat de app het daar aan Electron vraagt.
 * Op een tablet is het wel erg: daar vergelijkt de updater met dit nummer.
 */
const APP_VERSION = __APP_VERSION__

function detectChannel(): UpdateStore['channel'] {
  if (typeof window !== 'undefined' && window.desktop?.isElectron) return 'windows'
  if (Capacitor.isNativePlatform()) return 'mobile'
  return 'web'
}

export const useUpdates = create<UpdateStore>((set, get) => ({
  channel: detectChannel(),
  state: 'idle',
  version: APP_VERSION,
  newVersion: null,
  percent: 0,
  message: null,
  magInstalleren: true,
  bestand: null,

  init: async () => {
    const channel = detectChannel()
    set({ channel })

    if (channel === 'windows' && window.desktop) {
      try {
        set({ version: await window.desktop.getVersion() })
      } catch { /* niet kritiek */ }

      window.desktop.onUpdateStatus((p) => {
        switch (p.state) {
          case 'checking': set({ state: 'checking', message: null }); break
          case 'available': set({ state: 'available', newVersion: p.version }); break
          case 'up-to-date': set({ state: 'up-to-date' }); break
          case 'downloading': set({ state: 'downloading', percent: p.percent ?? 0 }); break
          case 'ready': set({ state: 'ready', newVersion: p.version, percent: 100 }); break
          case 'error': set({ state: 'error', message: p.message ?? 'Onbekende fout' }); break
        }
      })
      return
    }

    if (channel === 'mobile') {
      try {
        // De versie uit de APK zelf: bij een half gelukte update kan die
        // afwijken van de webbundel, en dan wil je weten wat er echt staat.
        const { versie } = await ApkUpdater.huidigeVersie()
        if (versie) set({ version: versie })
      } catch { /* oudere bouw zonder de plugin: dan de webversie */ }

      try {
        const { mag } = await ApkUpdater.mogelijk()
        set({ magInstalleren: mag })
      } catch { /* niet kritiek */ }

      try {
        await ApkUpdater.addListener('voortgang', ({ percent }) =>
          set({ state: 'downloading', percent }))
      } catch { /* niet kritiek */ }

      // Bij het opstarten meteen kijken, maar niet blokkerend: de app moet
      // open kunnen zonder op GitHub te wachten.
      void get().check()
    }
  },

  check: async () => {
    const { channel } = get()
    set({ state: 'checking', message: null })

    if (channel === 'windows' && window.desktop) {
      const res = await window.desktop.checkForUpdates()
      if (!res.ok) {
        set({
          state: res.reason === 'dev' ? 'up-to-date' : 'error',
          message: res.reason === 'dev' ? 'Ontwikkelmodus — updates uitgeschakeld' : res.reason ?? null,
        })
      }
      return
    }

    if (channel === 'mobile') {
      let nieuwer: Beschikbaar | null = null
      try {
        nieuwer = await kijkOfErEenUpdateIs(get().version)
      } catch {
        set({ state: 'error', message: 'Kon niet bij GitHub komen.' })
        return
      }

      if (!nieuwer) {
        set({ state: 'up-to-date' })
        return
      }

      set({ state: 'available', newVersion: nieuwer.versie, message: null })

      // Downloaden meteen, installeren pas als iemand erop tikt.
      try {
        set({ state: 'downloading', percent: 0 })
        const { pad } = await ApkUpdater.download({
          url: nieuwer.url,
          versie: nieuwer.versie,
          grootte: nieuwer.grootte,
        })
        set({ state: 'ready', percent: 100, bestand: pad })
      } catch (e) {
        set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // web
    set({ state: 'up-to-date', message: 'Web laadt automatisch de nieuwste versie' })
  },

  install: async () => {
    const { channel, bestand, magInstalleren } = get()

    if (channel === 'windows' && window.desktop) {
      return void window.desktop.installUpdate()
    }

    if (channel === 'mobile') {
      if (!bestand) {
        set({ state: 'error', message: 'Er staat geen download klaar.' })
        return
      }
      if (!magInstalleren) {
        // Zonder toestemming mislukt de installatie stil. Dus eerst vragen.
        await get().toestemmingVragen()
        return
      }
      try {
        await ApkUpdater.installeren({ pad: bestand })
      } catch (e) {
        set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    window.location.reload()
  },

  toestemmingVragen: async () => {
    try {
      await ApkUpdater.toestemmingVragen()
      const { mag } = await ApkUpdater.mogelijk()
      set({ magInstalleren: mag })
    } catch (e) {
      set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  },
}))
