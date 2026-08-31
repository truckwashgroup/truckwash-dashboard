import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { dateFull } from '../lib/format'

/* ------------------------------------------------------------------ *
 *  Tegels
 *
 *  Het startscherm van elk dashboard. Waarom: de zijbalk is prima als je
 *  de weg kent, maar wie er twee keer per week in komt zoekt. Een tegel
 *  laat in één oogopslag zien waar iets te doen is -- "4 bonnen wachten"
 *  is een reden om te klikken, "Financieel" niet.
 *
 *  Daarom draagt elke tegel een cijfer dat leeft. Staat er niets open, dan
 *  zegt de tegel dat ook; dat is net zo goed informatie.
 * ------------------------------------------------------------------ */

/** Wat er is weggeklikt, zodat het niet elke keer terugkomt. */
const WEGGEKLIKT = 'tw.aandacht'

export type TegelTint =
  'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'paars' | 'oranje' | 'neutraal'

export interface Tegel {
  key: string
  label: string
  hint: string
  icon: LucideIcon
  tint?: TegelTint
  /** Het cijfer dat op de tegel staat */
  stat?: ReactNode
  /** Waar dat cijfer over gaat, bijv. "wachten op akkoord" */
  statLabel?: string
  /** Zet de tegel op scherp: er is iets wat aandacht vraagt */
  urgent?: boolean
  onClick: () => void
}

export function Tegels({ items }: { items: Tegel[] }) {
  return (
    <div className="tegels">
      {items.map((t, i) => {
        const Icon = t.icon
        return (
          <motion.button
            key={t.key}
            className={`tegel t-${t.tint ?? 'neutraal'} ${t.urgent ? 'urgent' : ''}`}
            onClick={t.onClick}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: .26, delay: Math.min(i, 10) * 0.035, ease: [.22, .61, .36, 1] }}
          >
            <span className="ico"><Icon size={20} /></span>

            <span className="tekst">
              <strong>{t.label}</strong>
              <span>{t.hint}</span>
            </span>

            {t.stat !== undefined && (
              <span className="cijfer">
                <b>{t.stat}</b>
                {t.statLabel && <span>{t.statLabel}</span>}
              </span>
            )}

            <span className="pijl"><ArrowRight size={15} /></span>
          </motion.button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Startscherm
 * ------------------------------------------------------------------ */

export function Start({
  tegels, snel, children, onderschrift,
}: {
  tegels: Tegel[]
  /** Knoppen voor wat je meestal meteen wilt doen */
  snel?: ReactNode
  children?: ReactNode
  onderschrift?: string
}) {
  const user = useAuth((s) => s.user)
  const uur = new Date().getHours()
  const groet = uur < 6 ? 'Goedenacht' : uur < 12 ? 'Goedemorgen' : uur < 18 ? 'Goedemiddag' : 'Goedenavond'

  const dringend = tegels.filter((t) => t.urgent)

  /*
   * De aandachtsbalk kun je wegklikken.
   *
   * Waarom: een balk die er altijd staat, staat er voor niemand. Wie hem
   * drie dagen ziet met dezelfde inhoud leest hem niet meer, en dan werkt
   * hij ook niet meer op de dag dat er iets nieuws in staat.
   *
   * Wat we onthouden is precies wát er stond. Komt er iets bij, dan
   * verschijnt de balk weer -- want dan is het nieuws.
   */
  const vingerafdruk = dringend.map((t) => t.key).sort().join('|')
  const [weggeklikt, setWeggeklikt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(WEGGEKLIKT)
    } catch {
      return null
    }
  })

  function wegklikken() {
    try { localStorage.setItem(WEGGEKLIKT, vingerafdruk) } catch { /* privémodus */ }
    setWeggeklikt(vingerafdruk)
  }

  const toonBalk = dringend.length > 0 && weggeklikt !== vingerafdruk

  return (
    <>
      <div className="start-head">
        <div>
          <h2>{groet}, {user?.name.split(' ')[0]}</h2>
          <p>{onderschrift ?? dateFull(Date.now())}</p>
        </div>
        {snel && <div className="row" style={{ gap: 7 }}>{snel}</div>}
      </div>

      {toonBalk && (
        <div className="start-attentie">
          <span>Vraagt aandacht:</span>
          {dringend.map((t) => (
            <button key={t.key} className="btn sm" onClick={t.onClick}>
              {t.label}
              {t.stat !== undefined && <strong style={{ marginLeft: 4 }}>{t.stat}</strong>}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            className="btn ghost sm"
            onClick={wegklikken}
            title="Wegklikken tot er iets nieuws bij komt"
            aria-label="Wegklikken"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <Tegels items={tegels} />

      {children}
    </>
  )
}
