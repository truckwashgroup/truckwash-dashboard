import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, CalendarDays, Check, Clock, FileText, MapPin,
  PartyPopper, ShieldCheck, UserRound,
} from 'lucide-react'
import { db } from '../lib/db'
import { coverVan, fotoUrl, adresRegel } from '../lib/vestigingen'
import type { Location, LocationPhoto, User } from '../lib/types'
import { useAuth } from '../store/useAuth'
import Logo from './Logo'
import type { LucideIcon } from 'lucide-react'

/* ------------------------------------------------------------------ *
 *  Welkom
 *
 *  Wat er gebeurt op het moment dat iemand voor het eerst echt binnen is:
 *  hij is uitgenodigd, heeft het tijdelijke wachtwoord uit de mail gebruikt
 *  en zojuist zijn eigen wachtwoord gekozen. Daarna stond hij in een app die
 *  hij nog nooit had gezien, en dat was het.
 *
 *  Dit scherm neemt hem mee. Niet met een folder over wat de app allemaal
 *  kan, maar met de vier of vijf dingen die op zijn eerste dag echt tellen:
 *  waar hij werkt, waar zijn rooster staat, dat klokken aan de kassa gebeurt
 *  en niet hier, en waar zijn loonstrook straks komt.
 *
 *  Het is met opzet persoonlijk. Zijn eigen naam, zijn eigen vestiging met
 *  de foto erbij, zijn eigen leidinggevende. Een welkom dat "beste
 *  medewerker" zegt is geen welkom.
 *
 *  Daarna geeft hij het over aan de rondleiding, die de knoppen aanwijst.
 *  Dat is de volgorde die klopt: eerst weten waar je bent, dan waar je moet
 *  klikken.
 * ------------------------------------------------------------------ */

interface Stap {
  key: string
  icoon: LucideIcon
  titel: string
  tekst: string
  kleur: string
}

export default function Welkomst({ onKlaar }: { onKlaar: () => void }) {
  const me = useAuth((s) => s.user)
  const [stap, setStap] = useState(0)

  const locatie = useLiveQuery(
    async () => (me?.locationId ? db.locations.get(me.locationId) : undefined),
    [me?.locationId], undefined as Location | undefined)

  const chef = useLiveQuery(
    async () => (me?.supervisorId ? db.users.get(me.supervisorId) : undefined),
    [me?.supervisorId], undefined as User | undefined)

  const fotos = useLiveQuery(
    async () => (me?.locationId
      ? db.locationPhotos.where('locationId').equals(me.locationId).toArray()
      : []),
    [me?.locationId], [] as LocationPhoto[])

  const voornaam = (me?.name ?? '').trim().split(/\s+/)[0] || 'daar'

  /*
   * De stappen worden opgebouwd uit wat we van deze persoon weten. Een stap
   * over "jouw vestiging" bij iemand zonder vestiging is een lege belofte,
   * dus die valt er dan gewoon uit.
   */
  const stappen = useMemo<Stap[]>(() => {
    const uit: Stap[] = [{
      key: 'hallo',
      icoon: PartyPopper,
      titel: `Welkom, ${voornaam}`,
      tekst: 'Je wachtwoord staat goed en je bent binnen. Even laten zien '
           + 'waar je wat vindt — het duurt een halve minuut.',
      kleur: 'var(--brand)',
    }]

    if (locatie) {
      uit.push({
        key: 'waar',
        icoon: MapPin,
        titel: locatie.name,
        tekst: `Hier werk je. ${adresRegel(locatie) || ''}`.trim()
             + (locatie.bays ? ` ${locatie.bays} wasstraten.` : ''),
        kleur: 'var(--info, #7aa2ff)',
      })
    }

    if (chef) {
      uit.push({
        key: 'chef',
        icoon: UserRound,
        titel: chef.name,
        tekst: 'Je leidinggevende. Klopt er iets niet met je uren of je rooster, '
             + 'dan komt dat bij hem of haar terecht — via de app, zodat het '
             + 'niet in een appje blijft hangen.',
        kleur: 'var(--brand-2, var(--brand))',
      })
    }

    uit.push({
      key: 'rooster',
      icoon: CalendarDays,
      titel: 'Je rooster',
      tekst: 'Wanneer je werkt staat onder Rooster. Zodra er iets verandert '
           + 'krijg je er een mail over, dus je hoeft niet zelf te blijven kijken.',
      kleur: 'var(--ok)',
    })

    uit.push({
      key: 'klokken',
      icoon: Clock,
      titel: 'Klokken doe je aan de kassa',
      tekst: 'Niet in deze app. Je meldt je aan de kassa en die schrijft je uren weg. '
           + 'Hier zie je ze terug — en klopt er iets niet, dan vraag je een '
           + 'wijziging aan bij je leidinggevende.',
      kleur: 'var(--warn)',
    })

    uit.push({
      key: 'dossier',
      icoon: FileText,
      titel: 'Je loonstroken en papieren',
      tekst: 'Je contract, je loonstroken en alles wat er verder bij hoort staan '
           + 'onder Mijn zaken. Bekijken, downloaden of naar je eigen mail sturen.',
      kleur: 'var(--info, #7aa2ff)',
    })

    uit.push({
      key: 'klaar',
      icoon: ShieldCheck,
      titel: 'Dat was het',
      tekst: 'De rest wijst zich vanzelf. We lopen zo nog even langs de knoppen '
           + 'die je het meest gaat gebruiken.',
      kleur: 'var(--ok)',
    })

    return uit
  }, [voornaam, locatie, chef])

  const laatste = stap >= stappen.length - 1
  const huidig = stappen[Math.min(stap, stappen.length - 1)]
  const Icoon = huidig.icoon

  // Enter en spatie brengen je naar voren; Escape slaat het over.
  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onKlaar()
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (laatste) onKlaar()
        else setStap((s) => s + 1)
      }
    }
    window.addEventListener('keydown', toets)
    return () => window.removeEventListener('keydown', toets)
  }, [laatste, onKlaar])

  const cover = coverVan(fotos)

  return (
    <div className="welkom">
      {/* De foto van de eigen vestiging als achtergrond, ver weggedraaid. */}
      {cover && <WelkomFoto foto={cover} />}
      <div className="welkom-gloed" />

      <motion.div
        className="welkom-kaart"
        initial={{ opacity: 0, y: 26, scale: .97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <div className="welkom-kop">
          <Logo width={128} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={huidig.key}
            className="welkom-stap"
            initial={{ opacity: 0, x: 26 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -26 }}
            transition={{ duration: .26, ease: [.22, .61, .36, 1] }}
          >
            <motion.div
              className="welkom-icoon"
              style={{ color: huidig.kleur }}
              initial={{ scale: .5, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: .08, type: 'spring', stiffness: 300, damping: 15 }}
            >
              <Icoon size={30} />
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: .12 }}
            >
              {huidig.titel}
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: .18 }}
            >
              {huidig.tekst}
            </motion.p>
          </motion.div>
        </AnimatePresence>

        <div className="welkom-voet">
          <div className="welkom-bolletjes">
            {stappen.map((s, i) => (
              <button
                key={s.key}
                className={i === stap ? 'nu' : i < stap ? 'gehad' : ''}
                onClick={() => setStap(i)}
                aria-label={s.titel}
              />
            ))}
          </div>

          <span className="spacer" />

          {!laatste && (
            <button className="btn ghost sm" onClick={onKlaar}>Overslaan</button>
          )}
          <button
            className="btn primary"
            onClick={() => (laatste ? onKlaar() : setStap((s) => s + 1))}
          >
            {laatste
              ? <><Check size={15} /> Aan de slag</>
              : <>Verder <ArrowRight size={15} /></>}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/* De foto van de eigen vestiging, als die er is. Anders gewoon de gloed. */
function WelkomFoto({ foto }: { foto: LocationPhoto }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let levend = true
    let hier: string | null = null
    void fotoUrl(foto).then((u) => {
      if (!levend) { if (u) URL.revokeObjectURL(u); return }
      hier = u
      setUrl(u)
    })
    return () => { levend = false; if (hier) URL.revokeObjectURL(hier) }
  }, [foto.storagePath])

  if (!url) return null
  return (
    <motion.img
      className="welkom-achtergrond"
      src={url}
      alt=""
      initial={{ opacity: 0, scale: 1.12 }}
      animate={{ opacity: .22, scale: 1 }}
      transition={{ duration: 1.6, ease: [.22, .61, .36, 1] }}
    />
  )
}
