import { registerPlugin } from '@capacitor/core'

/* ------------------------------------------------------------------ *
 *  Bijwerken op een tablet
 *
 *  Dit bestand is gelijk aan dat van de kassa, op de naam van de repository
 *  na. Wijzig je hier iets, wijzig het daar ook -- of haal het over met
 *  scripts/kern-bijwerken.cjs in de kassa-repo.
 *
 *  Op Windows doet electron-updater dit werk. Op Android bestaat zo'n
 *  updater niet buiten de Play Store om, en de Play Store is voor een app die
 *  alleen binnen dit bedrijf draait een omweg met een wachttijd van dagen.
 *
 *  Dus kijkt de app zelf bij GitHub Releases -- dezelfde release waar de
 *  Windows-installer aan hangt -- en haalt daar de APK op. Eén release voor
 *  alles, en niets extra's om te hosten.
 *
 *  Wat de gebruiker merkt: een melding dat er een versie klaarstaat, en na
 *  het downloaden één keer tikken op "Installeren". Dat laatste kan niet
 *  anders, en het hoort ook zo: software die zichzelf zonder vraag kan
 *  vervangen is niet iets wat je op een kassa wil.
 * ------------------------------------------------------------------ */

/** Waar de releases staan. Publieke repo, dus geen sleutel nodig. */
const REPO = 'truckwashgroup/truckwash-dashboard'

export interface ApkUpdaterPlugin {
  /** Mag deze app een installatie starten? */
  mogelijk(): Promise<{ mag: boolean; versie: number }>
  /** De systeeminstelling openen waar de gebruiker dat toestaat. */
  toestemmingVragen(): Promise<void>
  download(opties: { url: string; versie: string; grootte?: number }):
    Promise<{ pad: string; grootte: number }>
  installeren(opties: { pad: string }): Promise<void>
  huidigeVersie(): Promise<{ versie: string }>
  addListener(
    gebeurtenis: 'voortgang',
    cb: (stand: { percent: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

export const ApkUpdater = registerPlugin<ApkUpdaterPlugin>('ApkUpdater')

/* ------------------------------------------------------------------ *
 *  Versies vergelijken
 * ------------------------------------------------------------------ */

/**
 * Vergelijkt twee versienummers.
 *
 * Geeft een positief getal als `a` nieuwer is dan `b`, nul als ze gelijk
 * zijn, negatief als `a` ouder is.
 *
 * Waarom niet gewoon `a > b`: dan is "0.10.0" ouder dan "0.9.0", want als
 * tekst komt "1" voor "9". Dat gaat precies één keer mis, en dan sta je met
 * een tablet die weigert bij te werken zonder te zeggen waarom.
 */
export function vergelijkVersies(a: string, b: string): number {
  const delen = (v: string) =>
    v.replace(/^v/, '').split(/[.\-+]/).map((d) => {
      const n = Number(d)
      return Number.isFinite(n) ? n : 0
    })

  const links = delen(a)
  const rechts = delen(b)

  for (let i = 0; i < Math.max(links.length, rechts.length); i++) {
    const verschil = (links[i] ?? 0) - (rechts[i] ?? 0)
    if (verschil !== 0) return verschil
  }
  return 0
}

/* ------------------------------------------------------------------ *
 *  Bij GitHub kijken
 * ------------------------------------------------------------------ */

export interface Beschikbaar {
  versie: string
  url: string
  grootte: number
  /** Wat er in de release staat, om aan de gebruiker te laten zien. */
  toelichting: string
}

/**
 * Kijkt of er een nieuwere versie is dan `huidig`.
 *
 * Geeft null terug als de app bij is, of als er niets te bereiken valt. Dat
 * laatste is geen fout die iemand hoort te zien: een tablet in een wasstraat
 * heeft geregeld geen bereik, en dat is precies waarom de rest van de app
 * daar niet op wacht.
 */
export async function kijkOfErEenUpdateIs(huidig: string): Promise<Beschikbaar | null> {
  try {
    const antwoord = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } },
    )
    if (!antwoord.ok) return null

    const release = await antwoord.json() as {
      tag_name?: string
      body?: string
      assets?: { name: string; browser_download_url: string; size: number }[]
    }

    const versie = (release.tag_name ?? '').replace(/^v/, '')
    if (!versie || vergelijkVersies(versie, huidig) <= 0) return null

    const apk = (release.assets ?? []).find((a) => a.name.toLowerCase().endsWith('.apk'))
    if (!apk) return null

    return {
      versie,
      url: apk.browser_download_url,
      grootte: apk.size,
      toelichting: (release.body ?? '').split('\n').slice(0, 6).join('\n').trim(),
    }
  } catch {
    // Geen bereik, of GitHub die even niet wil. Morgen weer.
    return null
  }
}
