import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, Check, Loader2, MessageCircleQuestion,
  SkipForward, Sparkles,
} from 'lucide-react'
import {
  legGesprekVast, volgendeVraag, vragenVoor, waaromGeenGesprek,
  type GesprekBeurt, type Vraag,
} from '../lib/devplan'
import { usePerms } from '../store/useNav'
import type { Ticket, User } from '../lib/types'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Doorvragen bij een melding
 *
 *  "Hij doet het niet" is waar en onbruikbaar. De vragen die daarna komen
 *  zijn de vragen die je anders drie dagen later alsnog stelt, als de melder
 *  allang is vergeten wat hij precies deed.
 *
 *  Twee wegen naar hetzelfde punt. Is er verbinding en staat de sleutel goed,
 *  dan vraagt de assistent door op wat er werkelijk gezegd is. Zo niet, dan
 *  loopt er een vaste lijst per soort melding -- minder scherp, maar iemand
 *  die met natte handschoenen op een tablet staat heeft niet altijd bereik,
 *  en dan moet zijn melding nog steeds bruikbaar binnenkomen.
 *
 *  Overslaan mag altijd. Een melder die vastloopt op een vraag die hij niet
 *  kan beantwoorden, is een melder die de volgende keer niets meldt.
 * ------------------------------------------------------------------ */

export default function Doorvragen({
  ticket, door, onKlaar,
}: {
  ticket: Ticket
  door: Pick<User, 'id' | 'name'>
  onKlaar: (beurten: GesprekBeurt[]) => void
}) {
  const [beurten, setBeurten] = useState<GesprekBeurt[]>([])
  const [vraag, setVraag] = useState<string | null>(null)
  const [keuzes, setKeuzes] = useState<string[] | undefined>()
  const [hint, setHint] = useState<string | undefined>()
  const [antwoord, setAntwoord] = useState('')
  const [bezig, setBezig] = useState(true)
  const [slim, setSlim] = useState(false)
  const [afgerond, setAfgerond] = useState(false)
  const [reden, setReden] = useState<string | null>(null)
  const perms = usePerms()

  /** De vaste lijst; alleen in gebruik als de server niet meedoet. */
  const lijst = useRef<Vraag[]>(vragenVoor(ticket.kind))
  const lijstIndex = useRef(0)
  const invoer = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { void volgende([]) }, [])
  useEffect(() => { if (vraag) invoer.current?.focus() }, [vraag])

  /** Zoek de volgende vraag: eerst bij de server, anders uit de lijst. */
  async function volgende(zover: GesprekBeurt[]) {
    setBezig(true)
    setAntwoord('')
    try {
      const vanServer = await volgendeVraag(ticket, zover)

      if (vanServer !== undefined) {
        setSlim(true)
        if (vanServer === null) return afronden(zover)
        setVraag(vanServer)
        setKeuzes(undefined)
        setHint(undefined)
        return
      }

      setReden(waaromGeenGesprek())

      // Terugval. Vragen die de server al heeft gesteld slaan we over door
      // simpelweg verder te tellen -- de lijst is een ondergrens, geen script.
      const volgendeUitLijst = lijst.current[lijstIndex.current]
      if (!volgendeUitLijst) return afronden(zover)
      lijstIndex.current += 1
      setVraag(volgendeUitLijst.tekst)
      setKeuzes(volgendeUitLijst.keuzes)
      setHint(volgendeUitLijst.hint)
    } finally {
      setBezig(false)
    }
  }

  async function afronden(zover: GesprekBeurt[]) {
    setVraag(null)
    setAfgerond(true)
    try {
      await legGesprekVast(ticket.id, zover, door)
    } catch {
      toast.info('Het gesprek is bewaard zodra er weer verbinding is')
    }
    onKlaar(zover)
  }

  async function beantwoord(tekst: string) {
    if (!vraag) return
    const nieuw = [...beurten, { vraag, antwoord: tekst }]
    setBeurten(nieuw)
    await volgende(nieuw)
  }

  if (afgerond) {
    return (
      <div className="doorvragen klaar">
        <Check size={20} />
        <div>
          <strong>Dank je — dit is genoeg om mee verder te kunnen.</strong>
          <span>
            Je melding staat onder <em>Mijn meldingen</em>. Je krijgt bericht
            zodra er iets mee gebeurt.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="doorvragen">
      <div className="kop">
        {slim ? <Sparkles size={16} /> : <MessageCircleQuestion size={16} />}
        <span>
          {slim
            ? 'Nog een paar vragen, dan weten we genoeg'
            : 'Een paar vaste vragen — je mag ze allemaal overslaan'}
        </span>
        {beurten.length > 0 && <span className="teller">{beurten.length} beantwoord</span>}
      </div>

      {/*
        * Alleen voor wie het kan repareren. De melder heeft niets aan een
        * mededeling over sleutels -- maar zonder dit staat er nergens waarom
        * er niet is doorgevraagd, en dan valt het pas op als iemand het mist.
        */}
      {!slim && reden && perms.can('dev.logs') && (
        <div className="signup-note" style={{ margin: 0 }}>
          <AlertTriangle size={16} />
          <span>Er is niet doorgevraagd: {reden}</span>
        </div>
      )}

      {beurten.map((b, i) => (
        <div className="beurt" key={i}>
          <div className="v">{b.vraag}</div>
          <div className="a">{b.antwoord}</div>
        </div>
      ))}

      {bezig && (
        <div className="denkt">
          <Loader2 size={15} className="spin" />
          <span>Even kijken…</span>
        </div>
      )}

      {!bezig && vraag && (
        <motion.div
          className="nu"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .22 }}
        >
          <div className="v">{vraag}</div>
          {hint && <div className="hint">{hint}</div>}

          {keuzes && (
            <div className="keuzes">
              {keuzes.map((k) => (
                <button key={k} className="btn sm" onClick={() => void beantwoord(k)}>
                  {k}
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={invoer}
            className="textarea"
            rows={3}
            placeholder={keuzes ? 'Of typ het zelf…' : 'Typ je antwoord…'}
            value={antwoord}
            onChange={(e) => setAntwoord(e.target.value.slice(0, 1500))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && antwoord.trim()) {
                void beantwoord(antwoord.trim())
              }
            }}
          />

          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn primary sm"
              disabled={!antwoord.trim()}
              onClick={() => void beantwoord(antwoord.trim())}
            >
              <ArrowRight size={14} /> Volgende
            </button>
            <button className="btn ghost sm" onClick={() => void volgende(beurten)}>
              <SkipForward size={14} /> Weet ik niet
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost sm" onClick={() => void afronden(beurten)}>
              Klaar hiermee
            </button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
