import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import * as Iconen from 'lucide-react'
import { ArrowRight, Check, ChevronLeft, X } from 'lucide-react'
import {
  RONDLEIDINGEN, metGezien, zichtbareAanwijzers,
  type Rondleiding as RondleidingType, type RondleidingAanwijzer,
} from '../lib/rondleiding'
import { users as userRepo } from '../lib/repo'
import type { Role } from '../lib/types'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'

/* ------------------------------------------------------------------ *
 *  De rondleiding
 *
 *  Twee delen achter elkaar. Eerst het verhaal: wat dit dashboard is en wat
 *  er van je wordt verwacht. Daarna de aanwijzers: pijlen naar de echte
 *  knoppen in het echte scherm.
 *
 *  Dat tweede deel is het deel dat blijft hangen. Een uitleg die je leest is
 *  iets anders dan een knop die je hebt zien oplichten op de plek waar hij
 *  morgen ook zit.
 *
 *  Weglopen mag altijd. Een rondleiding die je niet kunt afbreken is geen
 *  uitleg maar een sluis, en dan klikt iedereen hem weg zonder te lezen.
 * ------------------------------------------------------------------ */

type Fase = 'verhaal' | 'aanwijzen' | 'klaar'

export default function Rondleiding({
  rol, onSluiten,
}: {
  rol: Role
  onSluiten: () => void
}) {
  const me = useAuth((s) => s.user)
  const herlaad = useAuth((s) => s.herlaadProfiel)
  const perms = usePerms()

  const rondleiding: RondleidingType | undefined = RONDLEIDINGEN[rol]
  const aanwijzers = rondleiding ? zichtbareAanwijzers(rondleiding, perms.can) : []

  const [fase, setFase] = useState<Fase>('verhaal')
  const [stap, setStap] = useState(0)

  /** Onthouden dat hij is gezien, en dan pas weg. */
  const afsluiten = useCallback(async () => {
    if (me && rondleiding) {
      try {
        await userRepo.update(me.id, { seenTours: metGezien(me, rol) })
        await herlaad()
      } catch {
        /* Lukt het niet, dan ziet hij hem nog een keer. Dat is te overzien. */
      }
    }
    onSluiten()
  }, [me, rol, rondleiding, herlaad, onSluiten])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void afsluiten() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [afsluiten])

  if (!rondleiding) return null

  /* ---- het verhaal ------------------------------------------------ */

  if (fase === 'verhaal') {
    const scherm = rondleiding.schermen[stap]
    const laatste = stap === rondleiding.schermen.length - 1

    return createPortal(
      <div className="rondleiding-backdrop">
        <motion.div
          className="rondleiding-kaart"
          initial={{ opacity: 0, y: 24, scale: .97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: .34, ease: [.22, .61, .36, 1] }}
        >
          <button className="weg" onClick={() => void afsluiten()} title="Overslaan (Esc)">
            <X size={17} />
          </button>

          <AnimatePresence mode="wait">
            <motion.div
              key={scherm.id}
              initial={{ opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -26 }}
              transition={{ duration: .26, ease: [.22, .61, .36, 1] }}
            >
              <Prent tint={scherm.tint} icoon={scherm.icoon} sleutel={scherm.id} />

              <div className="tekst">
                <span className="rol">{rondleiding.naam}</span>
                <h2>{scherm.titel}</h2>
                <p>{scherm.tekst}</p>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="voet">
            <div className="stippen">
              {rondleiding.schermen.map((s, i) => (
                <button
                  key={s.id}
                  className={`stip ${i === stap ? 'nu' : i < stap ? 'gehad' : ''}`}
                  onClick={() => setStap(i)}
                  title={s.titel}
                />
              ))}
            </div>

            <div className="knoppen">
              {stap > 0 && (
                <button className="btn ghost sm" onClick={() => setStap((s) => s - 1)}>
                  <ChevronLeft size={15} /> Terug
                </button>
              )}
              {laatste ? (
                <button
                  className="btn primary"
                  onClick={() => {
                    if (aanwijzers.length === 0) return void afsluiten()
                    setFase('aanwijzen')
                    setStap(0)
                  }}
                >
                  {aanwijzers.length > 0 ? 'Laat het me zien' : 'Aan de slag'}
                  <ArrowRight size={15} />
                </button>
              ) : (
                <button className="btn primary" onClick={() => setStap((s) => s + 1)}>
                  Verder <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>

          <button className="overslaan" onClick={() => void afsluiten()}>
            Overslaan — je kunt hem later terugkijken bij je instellingen
          </button>
        </motion.div>
      </div>,
      document.body,
    )
  }

  /* ---- de aanwijzers ---------------------------------------------- */

  if (fase === 'aanwijzen') {
    return (
      <Aanwijzer
        aanwijzer={aanwijzers[stap]}
        nummer={stap + 1}
        totaal={aanwijzers.length}
        onVolgende={() => {
          if (stap + 1 >= aanwijzers.length) setFase('klaar')
          else setStap((s) => s + 1)
        }}
        onOverslaan={() => setFase('klaar')}
      />
    )
  }

  /* ---- klaar ------------------------------------------------------ */

  return createPortal(
    <div className="rondleiding-backdrop">
      <motion.div
        className="rondleiding-kaart klaar"
        initial={{ opacity: 0, scale: .94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}
      >
        <motion.div
          className="vink"
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: .12, type: 'spring', stiffness: 300, damping: 16 }}
        >
          <Check size={34} />
        </motion.div>
        <h2>Dat was het</h2>
        <p>
          Je weet nu waar alles staat. Kom je er toch niet uit, dan kun je deze
          rondleiding altijd opnieuw bekijken — hij staat bij je instellingen,
          onder je eigen naam rechtsboven.
        </p>
        <button className="btn primary lg" onClick={() => void afsluiten()}>
          Aan de slag
        </button>
      </motion.div>
    </div>,
    document.body,
  )
}

/* ================================================================== *
 *  Het plaatje bij een scherm
 *
 *  Geen illustratie maar een bewegend vlak met het icoon erin. Scheelt een
 *  map met plaatjes die bij de volgende huisstijl allemaal niet meer kloppen,
 *  en het past zich vanzelf aan het donkere thema aan.
 * ================================================================== */

function Prent({ tint, icoon, sleutel }: { tint: string; icoon: string; sleutel: string }) {
  const Icon = (Iconen as unknown as Record<string, typeof Check>)[icoon] ?? Iconen.Sparkles

  return (
    <div className={`rondleiding-prent t-${tint}`}>
      {/* Bellen, want we wassen vrachtwagens. */}
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={`${sleutel}-${i}`}
          className="bel"
          style={{ left: `${8 + i * 19}%`, width: 10 + (i % 3) * 8, height: 10 + (i % 3) * 8 }}
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: -30, opacity: [0, .55, 0] }}
          transition={{
            duration: 3.4 + i * .5,
            repeat: Infinity,
            delay: i * .45,
            ease: 'easeOut',
          }}
        />
      ))}

      <motion.div
        className="ico"
        initial={{ scale: .7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: .08, type: 'spring', stiffness: 260, damping: 18 }}
      >
        <Icon size={40} />
      </motion.div>
    </div>
  )
}

/* ================================================================== *
 *  Eén aanwijzer
 *
 *  Zoekt het element met data-rondleiding op, knipt er een gat in de
 *  verduistering en zet er een kaartje naast. Staat het element er niet --
 *  een scherm dat deze rol niet heeft -- dan slaan we hem over in plaats van
 *  een pijl naar niets te tonen.
 * ================================================================== */

function Aanwijzer({
  aanwijzer, nummer, totaal, onVolgende, onOverslaan,
}: {
  aanwijzer: RondleidingAanwijzer
  nummer: number
  totaal: number
  onVolgende: () => void
  onOverslaan: () => void
}) {
  const [vak, setVak] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    let weg = false

    const meten = () => {
      if (weg) return
      const el = document.querySelector<HTMLElement>(
        `[data-rondleiding="${aanwijzer.doel}"]`)
      if (!el) { onVolgende(); return }
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      setVak(el.getBoundingClientRect())
    }

    // Even wachten tot het scherm staat; anders meet je een halve animatie.
    const id = setTimeout(meten, 60)
    window.addEventListener('resize', meten)
    return () => {
      weg = true
      clearTimeout(id)
      window.removeEventListener('resize', meten)
    }
  }, [aanwijzer.doel, onVolgende])

  if (!vak) return null

  const marge = 6
  const onder = vak.bottom + 190 < window.innerHeight
  const rechts = vak.right + 320 < window.innerWidth

  return createPortal(
    <div className="aanwijzer-laag">
      <motion.div
        className="gat"
        initial={false}
        animate={{
          top: vak.top - marge,
          left: vak.left - marge,
          width: vak.width + marge * 2,
          height: vak.height + marge * 2,
        }}
        transition={{ duration: .3, ease: [.22, .61, .36, 1] }}
      />

      <motion.div
        className="ballon"
        initial={{ opacity: 0, scale: .96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: .22, delay: .1 }}
        style={{
          top: onder ? vak.bottom + 16 : Math.max(12, vak.top - 176),
          left: rechts
            ? Math.max(12, vak.left)
            : Math.max(12, Math.min(vak.right - 300, window.innerWidth - 312)),
        }}
      >
        <span className="teller">{nummer} van {totaal}</span>
        <h3>{aanwijzer.titel}</h3>
        <p>{aanwijzer.tekst}</p>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn primary sm" onClick={onVolgende}>
            {nummer === totaal ? 'Klaar' : 'Volgende'} <ArrowRight size={14} />
          </button>
          <button className="btn ghost sm" onClick={onOverslaan}>Overslaan</button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
