import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight, CalendarDays, ClipboardCheck, Download, Monitor, Receipt,
  ShieldCheck, Smartphone, Truck, WifiOff, Wrench,
} from 'lucide-react'
import Logo from './Logo'

/* ------------------------------------------------------------------ *
 *  De voorpagina
 *
 *  Wie het adres in een browser intikt en niet is ingelogd, kreeg meteen een
 *  inlogscherm. Dat is voor wie de app kent prima en voor iedereen daarbuiten
 *  een dichte deur zonder bordje: geen naam, geen uitleg, geen manier om te
 *  zien of je hier goed zit.
 *
 *  Deze pagina staat ervoor. Hij vertelt wat dit is, voor wie het is en waar
 *  je de app krijgt, en heeft één duidelijke knop naar het inloggen.
 *
 *  Drie dingen die hier met opzet NIET staan:
 *
 *    - namen van vestigingen, aantallen, of iets anders waar een
 *      buitenstaander de bedrijfsvoering uit kan aflezen. Dit is een publieke
 *      pagina; alles wat erop staat, staat op straat.
 *    - schermafbeeldingen van de app. Daar staan altijd gegevens op die er
 *      niet horen, en dat merk je pas als het al maanden online staat.
 *    - beloftes over wat de app straks kan. Wat er staat, is wat er is.
 *
 *  Hij verschijnt alleen in een browser. In de Windows-app en op de tablet
 *  wil je geen folder maar je werk: daar gaat het inlogscherm meteen open.
 * ------------------------------------------------------------------ */

interface Props {
  /** Naar het inlogscherm. */
  onInloggen: () => void
}

const WAT: { icoon: typeof Truck; titel: string; tekst: string }[] = [
  {
    icoon: CalendarDays,
    titel: 'Rooster en uren',
    tekst: 'Wanneer je werkt, en wat er is geschreven. Klopt er iets niet, dan '
         + 'vraag je een correctie aan bij je leidinggevende — met een spoor '
         + 'eronder, niet via een appje dat niemand terugvindt.',
  },
  {
    icoon: Truck,
    titel: 'De wasstraat',
    tekst: 'De wagens van vandaag, wie waarmee bezig is, en wat er is gedaan. '
         + 'Klaarmelden gaat op de vloer, niet achteraf op kantoor.',
  },
  {
    icoon: Wrench,
    titel: 'Techniek',
    tekst: 'Een storing melden met een foto erbij, werkbonnen afronden, en '
         + 'per installatie zien wanneer er onderhoud aan zat.',
  },
  {
    icoon: Receipt,
    titel: 'Administratie',
    tekst: 'Bonnen en facturen beoordelen. Wat er binnenkomt wordt voorgelezen '
         + '— leverancier, bedragen, regels — en jij beslist wat je overneemt.',
  },
]

const AARD: { icoon: typeof ShieldCheck; titel: string; tekst: string }[] = [
  {
    icoon: WifiOff,
    titel: 'Werkt zonder bereik',
    tekst: 'In een wasstraat valt de verbinding weg. De app werkt door en '
         + 'stuurt na wat er nog openstond. Er gaat niets verloren omdat de '
         + 'lijn er even uit lag.',
  },
  {
    icoon: ShieldCheck,
    titel: 'Iedereen ziet zijn eigen deel',
    tekst: 'Wat je mag zien hangt aan je rol, en dat wordt in de database '
         + 'afgedwongen — niet alleen in het scherm. Een dossier van een '
         + 'collega komt er niet eens uit.',
  },
  {
    icoon: ClipboardCheck,
    titel: 'Beslissingen laten een spoor na',
    tekst: 'Wie wat goedkeurde en wanneer, staat er bij. Niet om iemand te '
         + 'controleren, maar zodat je het een jaar later nog kunt navertellen.',
  },
]

export default function Voorpagina({ onInloggen }: Props) {
  const [platform, setPlatform] = useState<'windows' | 'android' | 'anders'>('anders')

  /*
   * Welk toestel kijkt er mee? Alleen om de juiste knop vooraan te zetten;
   * de andere blijven gewoon staan. Raden en dan de rest verbergen is
   * vervelender dan niet raden.
   */
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('android')) setPlatform('android')
    else if (ua.includes('windows')) setPlatform('windows')
  }, [])

  return (
    <div className="voorpagina">
      <header className="vp-balk">
        <Logo width={132} />
        <span className="spacer" />
        <button className="btn primary" onClick={onInloggen}>
          Inloggen <ArrowRight size={15} />
        </button>
      </header>

      {/* ------------------------------ hero ------------------------------ */}

      <section className="vp-hero">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .45, ease: [.22, .61, .36, 1] }}
        >
          <p className="vp-eyebrow">Truckwash 1 Group</p>
          <h1>
            Het dashboard waar<br />
            <span className="vp-geel">het werk in staat</span>
          </h1>
          <p className="vp-lead">
            Rooster, uren, wasbeurten, techniek en administratie — voor negentien
            vestigingen, op de werkplek en op de tablet in de wasstraat. Dit is
            de plek waar je inlogt.
          </p>
          <div className="vp-knoppen">
            <button className="btn primary lg" onClick={onInloggen}>
              Inloggen <ArrowRight size={16} />
            </button>
            <a className="btn ghost lg" href="#ophalen">
              <Download size={16} /> De app ophalen
            </a>
          </div>
          <p className="vp-klein">
            Nog geen account? Die krijg je van je leidinggevende of van kantoor.
          </p>
        </motion.div>
      </section>

      {/* ------------------------------ wat ------------------------------- */}

      <section className="vp-vak">
        <h2>Wat je ermee doet</h2>
        <div className="vp-raster">
          {WAT.map((w, i) => {
            const Icoon = w.icoon
            return (
              <motion.article
                key={w.titel}
                className="vp-kaart"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: .35, delay: Math.min(i * .06, .25) }}
              >
                <div className="vp-icoon"><Icoon size={20} /></div>
                <h3>{w.titel}</h3>
                <p>{w.tekst}</p>
              </motion.article>
            )
          })}
        </div>
      </section>

      {/* ------------------------------ aard ------------------------------ */}

      <section className="vp-vak vp-grijs">
        <h2>Hoe het is gebouwd</h2>
        <div className="vp-raster drie">
          {AARD.map((a, i) => {
            const Icoon = a.icoon
            return (
              <motion.article
                key={a.titel}
                className="vp-kaart"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: .35, delay: Math.min(i * .06, .25) }}
              >
                <div className="vp-icoon"><Icoon size={20} /></div>
                <h3>{a.titel}</h3>
                <p>{a.tekst}</p>
              </motion.article>
            )
          })}
        </div>
      </section>

      {/* ---------------------------- ophalen ----------------------------- */}

      <section className="vp-vak" id="ophalen">
        <h2>De app ophalen</h2>
        <p className="vp-onder">
          Je kunt hier in de browser werken, maar op een werkplek en op een
          tablet is de geïnstalleerde app prettiger: hij start sneller, werkt
          verder zonder bereik en werkt zichzelf bij.
        </p>

        <div className="vp-raster twee">
          <article className={`vp-kaart vp-haal ${platform === 'windows' ? 'nu' : ''}`}>
            <div className="vp-icoon"><Monitor size={20} /></div>
            <h3>Windows</h3>
            <p>
              Voor de werkplekken op kantoor en bij de vestiging. Downloaden,
              dubbelklikken, en updates komen daarna vanzelf binnen.
            </p>
            <a
              className="btn primary"
              href="https://github.com/truckwashgroup/truckwash-dashboard/releases/latest"
              target="_blank"
              rel="noreferrer noopener"
            >
              <Download size={15} /> Installatiebestand
            </a>
            <p className="vp-klein">
              Windows waarschuwt bij het openen dat de maker onbekend is. Kies
              dan <b>Meer informatie</b> en daarna <b>Toch uitvoeren</b>.
            </p>
          </article>

          <article className={`vp-kaart vp-haal ${platform === 'android' ? 'nu' : ''}`}>
            <div className="vp-icoon"><Smartphone size={20} /></div>
            <h3>Android</h3>
            <p>
              Voor de tablets in de wasstraat. Het bestand op het toestel
              zetten en erop tikken.
            </p>
            <a
              className="btn primary"
              href="https://github.com/truckwashgroup/truckwash-dashboard/releases/latest"
              target="_blank"
              rel="noreferrer noopener"
            >
              <Download size={15} /> APK-bestand
            </a>
            <p className="vp-klein">
              Android vraagt eenmalig om installeren uit een onbekende bron toe
              te staan. Dat is per app, en je zet het daarna niet terug.
            </p>
          </article>
        </div>

        <p className="vp-klein vp-midden">
          iOS is er nog niet. Daarvoor is een ontwikkelaarsaccount bij Apple
          nodig; tot die tijd werkt de app op een iPhone gewoon in de browser.
        </p>
      </section>

      {/* ------------------------------ voet ------------------------------ */}

      <footer className="vp-voet">
        <Logo width={104} />
        <p>
          Truckwash 1 Group — intern gereedschap. Vragen of iets kapot? Meld het
          in de app, onder <b>Melding maken</b>; dan komt het met de juiste
          gegevens binnen.
        </p>
        <button className="btn ghost sm" onClick={onInloggen}>
          Inloggen <ArrowRight size={14} />
        </button>
      </footer>
    </div>
  )
}
