import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Briefcase, Check, Loader2, ShieldCheck, X } from 'lucide-react'
import { db } from '../lib/db'
import { koppelingen, openKoppelverzoeken } from '../lib/werkgevers'
import type { WerkgeverKoppeling } from '../lib/types'
import { relative } from '../lib/format'
import { Card } from './ui'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Een werkgever wil je koppelen
 *
 *  Dit staat bovenaan het startscherm van wie zo'n verzoek heeft. Het is
 *  bewust een vraag en geen mededeling: iemand ongevraagd aan een bedrijf
 *  hangen zou betekenen dat een werkgever met het adres van een willekeurige
 *  chauffeur diens wasbeurten kan gaan meelezen.
 * ------------------------------------------------------------------ */

export default function Koppelverzoek() {
  const me = useAuth((s) => s.user)
  const links = useLiveQuery(() => db.employerLinks.toArray(), [], [] as WerkgeverKoppeling[])
  const [bezig, setBezig] = useState<string | null>(null)

  const open = openKoppelverzoeken(links, me)
  if (open.length === 0 || !me) return null

  return (
    <>
      {open.map((k) => (
        <Card key={k.id} className="mb">
          <div className="koppelverzoek">
            <div className="ico"><Briefcase size={24} /></div>

            <div className="tekst">
              <h3>{k.werkgeverNaam} wil je koppelen</h3>
              <p>
                {k.uitgenodigdDoorNaam} vraagt of je account gekoppeld mag worden
                aan <strong>{k.werkgeverNaam}</strong>. Gevraagd {relative(k.uitgenodigdOp)}.
              </p>
              <p className="klein">
                Ga je akkoord, dan ziet dat bedrijf de wasbeurten die op zijn
                naam staan — ook die jij brengt. Je eigen gegevens, je dossier
                en je wachtwoord blijven van jou; daar komt niemand bij.
              </p>
            </div>

            <div className="knoppen">
              <button
                className="btn primary sm"
                disabled={bezig === k.id}
                onClick={async () => {
                  setBezig(k.id)
                  try {
                    await koppelingen.aannemen(k, me)
                    toast.ok(`Je bent gekoppeld aan ${k.werkgeverNaam}`)
                  } finally { setBezig(null) }
                }}
              >
                {bezig === k.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                Akkoord
              </button>
              <button
                className="btn sm"
                disabled={bezig === k.id}
                onClick={async () => {
                  setBezig(k.id)
                  try {
                    await koppelingen.weigeren(k, me)
                    toast.info('Doorgegeven dat je niet akkoord gaat')
                  } finally { setBezig(null) }
                }}
              >
                <X size={14} /> Niet akkoord
              </button>
            </div>
          </div>

          <div className="signup-note" style={{ marginTop: 14, marginBottom: 0 }}>
            <ShieldCheck size={16} />
            <span>
              Ken je dit bedrijf niet? Klik dan op niet akkoord. Er gebeurt
              niets tot jij hier iets kiest.
            </span>
          </div>
        </Card>
      ))}
    </>
  )
}
