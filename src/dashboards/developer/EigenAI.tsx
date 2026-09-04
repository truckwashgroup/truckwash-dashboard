/* ===========================================================================
 *  De eigen AI
 *
 *  Op drie plekken denkt er een model mee: bij het lezen van een factuur, bij
 *  het gesprek dat volgt op een melding, en in de chatbot op de website. Alle
 *  drie konden dat alleen bij Claude; sinds 0049 en 0051 kan het ook op een
 *  eigen machine met Ollama.
 *
 *  Dit scherm is de plek waar je dat per stuk omzet, want ze zijn niet
 *  hetzelfde waard. Een factuur mag een minuut duren en niemand merkt het.
 *  Een melding: een paar tellen. Een bezoeker op de website die een vraag
 *  stelt: elke seconde telt.
 *
 *  Waar draait dat model
 *  ---------------------
 *
 *  Op ÉÉN machine, niet bij de gebruiker. Nu de pc op kantoor, straks de
 *  eigen server. Een bezoeker van de website praat gewoon met de
 *  serverfunctie en merkt er niets van; er wordt nooit iets gevraagd van zijn
 *  telefoon. Verhuist het model naar de server, dan verandert er hier niets:
 *  het programma in lezer/ draait dan daar.
 * =========================================================================== */

import { useEffect, useState } from 'react'
import { Cpu, RefreshCw, Save } from 'lucide-react'
import { SLEUTELS, leesInstellingen, zetInstelling } from '../../lib/instellingen'
import { relative } from '../../lib/format'
import { Card, Field } from '../../components/ui'
import { toast } from '../../store/useToasts'

type Keuze = 'claude' | 'lokaal' | 'lokaal-terugval'

const KEUZES: { waarde: Keuze; naam: string }[] = [
  { waarde: 'claude', naam: 'Claude (in de cloud)' },
  { waarde: 'lokaal', naam: 'Alleen de eigen machine' },
  { waarde: 'lokaal-terugval', naam: 'Eigen machine, Claude als terugval' },
]

/** De drie plekken, met wat je moet weten voordat je omzet. */
const PLEKKEN: {
  sleutel: string
  naam: string
  uitleg: string
  let: string
}[] = [
  {
    sleutel: SLEUTELS.factuurLezer,
    naam: 'Facturen lezen',
    uitleg: 'De PDF of foto die per mail binnenkomt uitlezen: leverancier, bedragen, btw, factuurnummer.',
    let: 'Hier is lokaal het meest op zijn plek: er zit niemand te wachten, en de factuur verlaat het pand niet. Bij foto’s van gekreukte bonnen leest Claude wel merkbaar beter.',
  },
  {
    sleutel: SLEUTELS.aiMelding,
    naam: 'Meedenken bij een melding',
    uitleg: 'Doorvragen bij wie iets meldt, en er daarna een plan van maken.',
    let: 'Een paar tellen wachten is hier geen probleem. Wel: dit vraagt om redeneren over een half verhaal, en daar zijn kleine modellen zwakker in dan bij het overtikken van een factuur.',
  },
  {
    sleutel: SLEUTELS.aiTrucky,
    naam: 'Trucky op de website',
    uitleg: 'De chatbot die bezoekers te woord staat.',
    let: 'Hier staat iemand op een parkeerplaats naar zijn telefoon te kijken. Zet dit alleen op “eigen machine, Claude als terugval” — bij alleen lokaal krijgt een bezoeker een foutmelding zodra de machine uit staat.',
  },
]

export default function EigenAI() {
  const [waarden, setWaarden] = useState<Record<string, string>>({})
  const [model, setModel] = useState('gemma4:26b')
  const [wachttijd, setWachttijd] = useState('20')
  const [gezien, setGezien] = useState<number | null>(null)
  const [lezerModel, setLezerModel] = useState('')
  const [geladen, setGeladen] = useState(false)
  const [bezig, setBezig] = useState(false)

  async function laad() {
    const alle = await leesInstellingen()
    setWaarden(Object.fromEntries(PLEKKEN.map((p) => [p.sleutel, alle[p.sleutel] || 'claude'])))
    setModel(alle[SLEUTELS.aiLokaalModel] || 'gemma4:26b')
    setWachttijd(alle[SLEUTELS.aiWachttijd] || '20')
    const t = Number(alle[SLEUTELS.lezerLaatstGezien])
    setGezien(Number.isFinite(t) && t > 0 ? t : null)
    setLezerModel(alle[SLEUTELS.lezerModel] || '')
    setGeladen(true)
  }

  useEffect(() => { void laad() }, [])

  const ietsLokaal = PLEKKEN.some((p) => (waarden[p.sleutel] ?? 'claude') !== 'claude')

  /*
   * Stil sinds meer dan vijf minuten terwijl er wél lokaal werk verwacht
   * wordt: dat is het geval waarin je het wilt weten. Staat alles op Claude,
   * dan hoeft de machine ook niet te draaien en is stilte geen probleem.
   */
  const stil = ietsLokaal && (gezien === null || Date.now() - gezien > 5 * 60_000)

  async function bewaar() {
    setBezig(true)
    try {
      for (const p of PLEKKEN) {
        await zetInstelling(p.sleutel, waarden[p.sleutel] ?? 'claude')
      }
      await zetInstelling(SLEUTELS.aiLokaalModel, model.trim() || 'gemma4:26b')
      await zetInstelling(
        SLEUTELS.aiWachttijd,
        String(Math.min(50, Math.max(5, Number(wachttijd) || 20))),
      )
      toast.ok('Opgeslagen.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Card
      title="De eigen AI"
      hint="Waar het denkwerk gebeurt: bij Claude of op de eigen machine"
    >
      <p className="help" style={{ marginBottom: 14 }}>
        Het model draait op <strong>één machine</strong> — nu de pc op kantoor,
        straks de eigen server. Een bezoeker van de website merkt er niets van
        en er draait nooit iets op zijn eigen apparaat. Verhuist het model,
        dan hoef je hier niets te wijzigen: het programma in <code>lezer/</code>
        {' '}draait dan daar.
      </p>

      {/* ---- of de machine leeft ---- */}

      <div
        className={stil ? 'waarschuwing zacht mb' : 'hint'}
        style={{ marginBottom: 16 }}
      >
        <Cpu size={15} style={{ verticalAlign: -2 }} />{' '}
        {gezien === null
          ? 'De machine heeft zich nog nooit gemeld.'
          : <>Laatst gemeld {relative(gezien)}{lezerModel ? ` met ${lezerModel}` : ''}.</>}
        {stil && (
          <> Er staat werk voor de eigen machine klaar, maar hij is stil.
            Draait het programma in <code>lezer/</code>? Bij “Claude als
            terugval” merkt niemand het; bij “alleen de eigen machine” wel.</>
        )}
        <button
          className="btn ghost sm"
          style={{ marginLeft: 8 }}
          onClick={() => void laad()}
        >
          <RefreshCw size={13} /> Ververs
        </button>
      </div>

      {/* ---- de drie plekken ---- */}

      {PLEKKEN.map((p) => (
        <div key={p.sleutel} style={{ marginBottom: 18 }}>
          <Field label={p.naam} help={p.uitleg}>
            <select
              className="select"
              value={waarden[p.sleutel] ?? 'claude'}
              disabled={!geladen}
              onChange={(e) => setWaarden((w) => ({ ...w, [p.sleutel]: e.target.value }))}
            >
              {KEUZES.map((k) => (
                <option key={k.waarde} value={k.waarde}>{k.naam}</option>
              ))}
            </select>
          </Field>
          <p className="help" style={{ marginTop: 4 }}>{p.let}</p>
        </div>
      ))}

      {/* ---- model en geduld ---- */}

      <div className="grid cols-2 mb">
        <Field
          label="Model voor meldingen en Trucky"
          help="Hoeft geen plaatjes te kunnen lezen; dat is alleen voor facturen. Welk model de facturen leest staat in lezer/.env."
        >
          <input
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gemma4:26b"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Hoe lang de server wacht (seconden)"
          help="Daarna een nette melding, of Claude bij terugval. Tussen 5 en 50."
        >
          <input
            className="input"
            type="number"
            min={5}
            max={50}
            value={wachttijd}
            onChange={(e) => setWachttijd(e.target.value)}
          />
        </Field>
      </div>

      <div className="row">
        <button className="btn primary" onClick={() => void bewaar()} disabled={bezig || !geladen}>
          <Save size={16} /> Opslaan
        </button>
      </div>
    </Card>
  )
}
