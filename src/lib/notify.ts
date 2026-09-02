import { Capacitor } from '@capacitor/core'

/* ------------------------------------------------------------------ *
 *  Meldingen op het apparaat zelf
 *
 *  Drie platformen, drie mechanismen, één functie:
 *    Windows  -> Electron toont een systeemmelding
 *    iOS/And. -> Capacitor LocalNotifications
 *    Web      -> de Notification-API van de browser
 *
 *  Lukt geen van alle, dan is dat geen fout: de melding staat sowieso in de
 *  app zelf, bij het belletje in de balk.
 * ------------------------------------------------------------------ */

let localNotifications: any = null

async function loadCapacitorNotifications() {
  if (!Capacitor.isNativePlatform()) return null
  if (localNotifications) return localNotifications
  try {
    const spec = '@capacitor/local-notifications'
    const mod = await import(/* @vite-ignore */ spec)
    localNotifications = (mod as any).LocalNotifications ?? null
  } catch {
    localNotifications = null
  }
  return localNotifications
}

export type NotifyPermission = 'granted' | 'denied' | 'unsupported'

/** Vraagt eenmalig toestemming. Zonder toestemming blijft de app werken. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  // Windows: Electron mag altijd, het besturingssysteem regelt de rest.
  if (typeof window !== 'undefined' && window.desktop?.isElectron) return 'granted'

  const native = await loadCapacitorNotifications()
  if (native) {
    try {
      const res = await native.requestPermissions()
      return res?.display === 'granted' ? 'granted' : 'denied'
    } catch {
      return 'denied'
    }
  }

  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return (await Notification.requestPermission()) === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

export function notifyPermissionState(): NotifyPermission {
  if (typeof window !== 'undefined' && window.desktop?.isElectron) return 'granted'
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission === 'granted'
    ? 'granted'
    : Notification.permission === 'denied'
      ? 'denied'
      : 'unsupported'
}

let seq = 1

/** Toont een melding buiten de app om. Faalt stil. */
export async function showDeviceNotification(title: string, body: string) {
  try {
    if (typeof window !== 'undefined' && window.desktop?.notify) {
      await window.desktop.notify(title, body)
      return
    }

    const native = await loadCapacitorNotifications()
    if (native) {
      await native.schedule({
        notifications: [{
          id: seq++,
          title,
          body,
          smallIcon: 'ic_launcher',
        }],
      })
      return
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // eslint-disable-next-line no-new
      // './' en niet '/', want dit bestand draait in twee apps op drie
      // manieren en een absoluut pad klopt in geen van drieën. Het dashboard
      // staat op /app/, dus '/icons/' wijst daar naar de wortel van de
      // merksite. In Electron wordt de pagina via file:// geladen, en dan
      // wijst '/icons/' naar de wortel van de schijf. Relatief lost het
      // overal op naast het document waar het icoon ook werkelijk staat.
      new Notification(title, { body, icon: './icons/icon-192.webp', tag: 'truckwash' })
    }
  } catch {
    /* een melding die niet lukt mag nooit de app raken */
  }
}
