import { useState } from 'react'
import {
  AlertTriangle, Check, Loader2, Send, ShieldCheck, Trash2, UserMinus, UserPlus,
} from 'lucide-react'
import { personeel } from '../lib/personeel'
import type { User } from '../lib/types'
import { dateShort } from '../lib/format'
import { Card, Field, Modal } from './ui'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Uitnodigen, uitschrijven en wissen
 *
 *  Drie handelingen die op elkaar lijken en het niet zijn.
 *
 *  Uitnodigen bestaat omdat iemand die geen uitnodiging krijgt zich zelf gaat
 *  aanmelden -- met zijn privé-adres -- en dan staan er twee dossiers van
 *  dezelfde man. De koppeling kijkt op e-mailadres en ziet twee verschillende
 *  mensen.
 *
 *  Uitschrijven en wissen zijn niet hetzelfde, en dat verschil is de reden
 *  dat het twee knoppen zijn. Loonadministratie en getekende contracten
 *  bewaar je zeven jaar; wat er bij uit dienst gebeurt is dat iemand uit
 *  beeld gaat, niet dat hij verdwijnt. Wissen is voor een verzoek tot
 *  verwijdering, en dat hoort een aparte handeling te zijn -- met een reden
 *  die blijft staan nadat de persoon weg is.
 * ------------------------------------------------------------------ */

export default function PersoonBeheer({
  person, onWeg,
}: {
  person: User
  onWeg: () => void
}) {
  const [bezig, setBezig] = useState(false)
  const [uitschrijven, setUitschrijven] = useState(false)
  const [wissen, setWissen] = useState(false)
  const [reden, setReden] = useState('')
  const [bevestig, setBevestig] = useState('')

  const heeftAccount = !!person.authId
  const uitgeschreven = !!person.archivedAt

  return (
    <>
      <Card title="Beheer" hint="Toegang en uit dienst" className="mt">
        {uitgeschreven && (
          <div className="signup-note" style={{ marginBottom: 14 }}>
            <UserMinus size={16} />
            <span>
              Uitgeschreven op {dateShort(person.archivedAt!)}
              {person.archiveReason ? ` — ${person.archiveReason}` : ''}. Hij
              staat nergens meer tussen, maar zijn uren, wasbeurten en
              getekende contracten blijven bewaard.
            </span>
          </div>
        )}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!heeftAccount && !uitgeschreven && (
            <button
              className="btn primary sm"
              disabled={bezig || !person.email}
              title={person.email ? undefined : 'Er staat geen e-mailadres bij dit dossier'}
              onClick={async () => {
                setBezig(true)
                try {
                  const uit = await personeel.uitnodigen(person.id)
                  if (!uit.ok) return toast.error(uit.reden ?? 'Uitnodigen lukte niet')
                  toast.ok(uit.soort === 'gekoppeld'
                    ? 'Er bestond al een account op dit adres; dat is nu gekoppeld'
                    : 'De uitnodiging is verstuurd')
                } finally { setBezig(false) }
              }}
            >
              {bezig ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              Uitnodigen
            </button>
          )}

          {heeftAccount && !uitgeschreven && (
            <span className="badge ok"><Check size={11} /> heeft een inlogaccount</span>
          )}

          <span style={{ flex: 1 }} />

          {uitgeschreven ? (
            <button
              className="btn sm"
              disabled={bezig}
              onClick={async () => {
                setBezig(true)
                try {
                  const uit = await personeel.terugzetten(person.id)
                  if (uit.ok) toast.ok('Weer in dienst')
                  else toast.error(uit.reden ?? 'Terugzetten lukte niet')
                } finally { setBezig(false) }
              }}
            >
              <UserPlus size={14} /> Terugzetten
            </button>
          ) : (
            <button className="btn sm" onClick={() => { setReden(''); setUitschrijven(true) }}>
              <UserMinus size={14} /> Uitschrijven
            </button>
          )}

          <button
            className="btn danger sm"
            onClick={() => { setReden(''); setBevestig(''); setWissen(true) }}
          >
            <Trash2 size={14} /> Wissen
          </button>
        </div>
      </Card>

      {/* ------------------------- uitschrijven --------------------- */}

      <Modal
        open={uitschrijven}
        title={`${person.name} uitschrijven`}
        subtitle="Uit dienst, maar niet uit de administratie"
        onClose={() => setUitschrijven(false)}
      >
        <div className="signup-note">
          <ShieldCheck size={16} />
          <span>
            Hij kan niet meer inloggen en staat nergens meer tussen — niet in
            het rooster, niet in de lijsten. Zijn uren, wasbeurten en getekende
            contracten blijven staan, want die moet je zeven jaar bewaren.
            Terugdraaien kan.
          </span>
        </div>

        <Field label="Reden" help="Komt in het dossier te staan.">
          <input
            className="input"
            value={reden}
            onChange={(e) => setReden(e.target.value.slice(0, 300))}
            placeholder="Bijv. uit dienst per 1 oktober"
          />
        </Field>

        <div className="row end">
          <button className="btn ghost" onClick={() => setUitschrijven(false)}>Annuleren</button>
          <button
            className="btn primary"
            disabled={bezig || !reden.trim()}
            onClick={async () => {
              setBezig(true)
              try {
                const uit = await personeel.uitschrijven(person.id, reden)
                if (!uit.ok) return toast.error(uit.reden ?? 'Uitschrijven lukte niet')
                setUitschrijven(false)
                toast.ok(`${person.name} is uitgeschreven`)
              } finally { setBezig(false) }
            }}
          >
            <UserMinus size={15} /> Uitschrijven
          </button>
        </div>
      </Modal>

      {/* ---------------------------- wissen ------------------------ */}

      <Modal
        open={wissen}
        title={`${person.name} wissen`}
        subtitle="Onomkeerbaar"
        onClose={() => setWissen(false)}
      >
        <div className="waarschuwing">
          <AlertTriangle size={17} />
          <span>
            <strong>Dit is niet terug te draaien.</strong> Het dossier, het
            inlogaccount en alles wat eraan hangt verdwijnt. Zoek je uit
            dienst? Gebruik dan uitschrijven — dat bewaart wat je wettelijk
            moet bewaren.
          </span>
        </div>

        <Field label="Waarom" help="Deze reden blijft staan nadat de persoon weg is.">
          <input
            className="input"
            value={reden}
            onChange={(e) => setReden(e.target.value.slice(0, 400))}
            placeholder="Bijv. verzoek tot verwijdering, bewaartermijn verstreken"
          />
        </Field>

        <Field label={`Typ ter bevestiging de naam: ${person.name}`}>
          <input
            className="input"
            value={bevestig}
            onChange={(e) => setBevestig(e.target.value)}
            placeholder={person.name}
          />
        </Field>

        <div className="row end">
          <button className="btn ghost" onClick={() => setWissen(false)}>Annuleren</button>
          <button
            className="btn danger"
            disabled={bezig || reden.trim().length < 5 || bevestig.trim() !== person.name}
            onClick={async () => {
              setBezig(true)
              try {
                const uit = await personeel.wissen(person.id, reden)
                if (!uit.ok) return toast.error(uit.reden ?? 'Wissen lukte niet')
                setWissen(false)
                toast.info(`${person.name} is gewist`)
                onWeg()
              } finally { setBezig(false) }
            }}
          >
            <Trash2 size={15} /> Definitief wissen
          </button>
        </div>
      </Modal>
    </>
  )
}
