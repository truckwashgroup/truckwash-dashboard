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
import { Cpu, Loader2, RefreshCw, Save, TriangleAlert } from 'lucide-react'
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

/** Wat de werkmachine van zichzelf doorgeeft (lezer_stand). */
interface Stand {
  bezig: string | null
  sinds: number | null
  facturen: number
  aiVragen: number
  mislukt: number
  laatsteFout: string | null
  modelTekst?: string
  modelBeeld?: string
}

/**
 * De stand uitpakken.
 *
 * Het is tekst uit de database die door een ander programma is geschreven, dus
 * hij kan van alles zijn -- leeg, oud, of van een versie die andere velden
 * kende. Bij twijfel null: dan toont het scherm alleen "laatst gemeld", en dat
 * klopt altijd.
 */
function leesStand(ruw: string | undefined): Stand | null {
  if (!ruw) return null
  try {
    const d = JSON.parse(ruw) as Partial<Stand>
    return {
      bezig: typeof d.bezig === 'string' ? d.bezig : null,
      sinds: typeof d.sinds === 'number' ? d.sinds : null,
      facturen: Number(d.facturen) || 0,
      aiVragen: Number(d.aiVragen) || 0,
      mislukt: Number(d.mislukt) || 0,
      laatsteFout: typeof d.laatsteFout === 'string' ? d.laatsteFout : null,
      modelTekst: typeof d.modelTekst === 'string' ? d.modelTekst : undefined,
      modelBeeld: typeof d.modelBeeld === 'string' ? d.modelBeeld : undefined,
    }
  } catch {
    return null
  }
}

/** "8s" of "1m 20s" -- kort, want het staat midden in een zin. */
function seconden(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function EigenAI() {
  const [waarden, setWaarden] = useState<Record<string, string>>({})
  const [model, setModel] = useState('gemma4:26b')
  const [wachttijd, setWachttijd] = useState('20')
  const [gezien, setGezien] = useState<number | null>(null)
  const [lezerModel, setLezerModel] = useState('')
  const [stand, setStand] = useState<Stand | null>(null)
  /*
   * Tikt elke seconde, alleen om "al 12s" te laten oplopen terwijl je kijkt.
   * Zonder dit staat er een tijd stil die niet stilstaat.
   */
  const [, tik] = useState(0)
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
    setStand(leesStand(alle[SLEUTELS.lezerStand]))
    setGeladen(true)
  }

  /*
   * Bij het openen laden, en daarna elke vijf seconden opnieuw. De machine
   * meldt zich elke tien seconden (of vaker als er werk is), dus sneller
   * verversen levert niets nieuws op.
   */
  useEffect(() => {
    void laad()
    const t = setInterval(() => { void laad() }, 5000)
    const s = setInterval(() => tik((n) => n + 1), 1000)
    return () => { clearInterval(t); clearInterval(s) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

      {/* ---- of de machine leeft, en wat hij doet ---- */}

      <div
        className={stil ? 'waarschuwing zacht mb' : 'ts-stand mb'}
        style={{ padding: '12px 14px', borderRadius: 'var(--radius-sm)', background: stil ? undefined : 'var(--surface-2)' }}
      >
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {stand?.bezig
            ? <Loader2 size={15} className="spin" />
            : stil ? <TriangleAlert size={15} /> : <Cpu size={15} />}

          <strong style={{ flex: 1 }}>
            {stand?.bezig
              ? <>Bezig: {stand.bezig}{stand.sinds ? ` — al ${seconden(Date.now() - stand.sinds)}` : ''}</>
              : gezien === null
                ? 'De machine heeft zich nog nooit gemeld.'
                : stil
                  ? 'De machine is stil.'
                  : 'Klaar voor werk, niets te doen.'}
          </strong>

          <button className="btn ghost sm" onClick={() => void laad()}>
            <RefreshCw size={13} /> Ververs
          </button>
        </div>

        <p className="help" style={{ margin: '6px 0 0' }}>
          {gezien !== null && <>Laatst gemeld {relative(gezien)}{lezerModel ? ` met ${lezerModel}` : ''}. </>}
          {stand && (
            <>Vandaag {stand.facturen} {stand.facturen === 1 ? 'factuur' : 'facturen'} gelezen
              {stand.aiVragen > 0 && <>, {stand.aiVragen} {stand.aiVragen === 1 ? 'vraag' : 'vragen'} beantwoord</>}
              {stand.mislukt > 0 && <>, {stand.mislukt} mislukt</>}.{' '}
              {stand.modelTekst && stand.modelBeeld && (
                stand.modelTekst === stand.modelBeeld
                  ? <>Model {stand.modelBeeld}. </>
                  : <>Tekst {stand.modelTekst}, beeld {stand.modelBeeld}. </>
              )}
            </>
          )}
          {stil && (
            <>Er staat werk voor de eigen machine klaar, maar hij meldt zich niet.
              Draait het programma in <code>lezer/</code>? Bij “Claude als terugval”
              merkt niemand het; bij “alleen de eigen machine” wel.</>
          )}
        </p>

        {stand?.laatsteFout && (
          <p className="help" style={{ margin: '6px 0 0', color: 'var(--text-warn)' }}>
            Laatste fout: {stand.laatsteFout}
          </p>
        )}
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
