import { useState } from 'react'
import {
  Bell, BellOff, Check, Loader2, Monitor, Moon, RefreshCw, Sparkles, Sun, Wind,
} from 'lucide-react'
import { Modal } from './ui'
import {
  BEWEGING_LABELS, THEMA_LABELS, useTheme,
  type BewegingKeuze, type ThemeKeuze,
} from '../lib/theme'
import { useAuth } from '../store/useAuth'
import { initials } from '../lib/format'
import { useUpdates } from '../lib/updates'
import { haalAllesOpnieuw, useSync } from '../lib/sync'
import { notifyPermissionState, requestNotifyPermission } from '../lib/notify'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Persoonlijke instellingen
 *
 *  Alles hier geldt voor dit apparaat, niet voor het dossier. Iemand die
 *  overdag op kantoor zit en 's avonds in de cabine wil niet dat zijn keuze
 *  meereist naar het andere scherm. Dat staat er ook zo bij, want anders
 *  gaat iemand zoeken waarom zijn telefoon iets anders doet dan zijn laptop.
 * ------------------------------------------------------------------ */

const THEMA_ICON: Record<ThemeKeuze, typeof Sun> = {
  systeem: Monitor,
  licht: Sun,
  donker: Moon,
}

const BEWEGING_ICON: Record<BewegingKeuze, typeof Sun> = {
  systeem: Monitor,
  vol: Sparkles,
  rustig: Wind,
}

export default function Instellingen({
  open, onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const me = useAuth((s) => s.user)
  const wachtrij = useSync((s) => s.pending)
  const [bezigMetHerladen, setBezigMetHerladen] = useState(false)
  const version = useUpdates((s) => s.version)
  const { thema, beweging, setThema, setBeweging } = useTheme()
  const [melding, setMelding] = useState(notifyPermissionState())

  async function meldingenAanzetten() {
    const uitkomst = await requestNotifyPermission()
    setMelding(uitkomst)
    if (uitkomst === 'granted') toast.ok('Meldingen staan aan')
    else if (uitkomst === 'denied') {
      toast.warn('Je apparaat houdt meldingen tegen. Zet ze aan bij de app-instellingen.')
    }
  }

  return (
    <Modal
      open={open}
      title="Persoonlijke instellingen"
      subtitle="Deze keuzes gelden voor dit apparaat"
      onClose={onClose}
      width={560}
    >
      {me && (
        <div className="inst-persoon">
          <div className="person-avatar">{initials(me.name)}</div>
          <div style={{ minWidth: 0 }}>
            <strong>{me.name}</strong>
            <div>{me.email}</div>
          </div>
        </div>
      )}

      {/* ------------------------- Uiterlijk ------------------------ */}

      <div className="inst-groep">
        <div className="inst-kop">Uiterlijk</div>
        <div className="keuze-rij">
          {(Object.keys(THEMA_LABELS) as ThemeKeuze[]).map((k) => {
            const Icon = THEMA_ICON[k]
            return (
              <button
                key={k}
                type="button"
                className={`keuze ${thema === k ? 'on' : ''}`}
                onClick={() => setThema(k)}
              >
                <Icon size={19} />
                <strong>{THEMA_LABELS[k].label}</strong>
                <span>{THEMA_LABELS[k].hint}</span>
                {thema === k && <Check size={14} className="vink" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* ------------------------- Beweging ------------------------- */}

      <div className="inst-groep">
        <div className="inst-kop">Beweging</div>
        <div className="keuze-rij">
          {(Object.keys(BEWEGING_LABELS) as BewegingKeuze[]).map((k) => {
            const Icon = BEWEGING_ICON[k]
            return (
              <button
                key={k}
                type="button"
                className={`keuze ${beweging === k ? 'on' : ''}`}
                onClick={() => setBeweging(k)}
              >
                <Icon size={19} />
                <strong>{BEWEGING_LABELS[k].label}</strong>
                <span>{BEWEGING_LABELS[k].hint}</span>
                {beweging === k && <Check size={14} className="vink" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* ------------------------- Meldingen ------------------------ */}

      <div className="inst-groep">
        <div className="inst-kop">Meldingen op dit apparaat</div>
        <div className="setting-row">
          <div>
            <div className="setting-label">
              {melding === 'granted' ? 'Staan aan' :
               melding === 'denied' ? 'Worden tegengehouden' : 'Nog niet gevraagd'}
            </div>
            <div className="setting-hint">
              {melding === 'granted'
                ? 'Nieuwe berichten en storingen komen ook binnen als de app dicht staat.'
                : melding === 'denied'
                  ? 'Je apparaat houdt ze tegen. Dat zet je aan bij de instellingen van het apparaat zelf, niet hier.'
                  : 'Zonder toestemming zie je meldingen alleen in de app, bij het belletje.'}
            </div>
          </div>
          {melding === 'granted' ? (
            <span className="badge ok"><Bell size={12} /> Aan</span>
          ) : melding === 'denied' ? (
            <span className="badge"><BellOff size={12} /> Uit</span>
          ) : (
            <button className="btn sm" onClick={() => void meldingenAanzetten()}>
              <Bell size={14} /> Aanzetten
            </button>
          )}
        </div>
      </div>

      {/* ------------------------- De gegevens ---------------------- */}

      <div className="inst-groep">
        <div className="inst-kop">De gegevens op dit apparaat</div>
        <div className="setting-row">
          <div>
            <div className="setting-label">Alles opnieuw ophalen</div>
            <div className="setting-hint">
              De app haalt alleen op wat er is veranderd, en dat is bijna altijd
              genoeg. Maar iets dat op de server is weggehaald verandert nooit
              meer, dus dat kan hier blijven staan — een medewerker die er niet
              meer is, bijvoorbeeld. Hiermee wordt de kopie weggegooid en
              helemaal opnieuw opgebouwd.
              {wachtrij > 0 && (
                <> Wat nog niet verstuurd is ({wachtrij}) blijft staan.</>
              )}
            </div>
          </div>
          <button
            className="btn sm"
            disabled={bezigMetHerladen}
            onClick={async () => {
              setBezigMetHerladen(true)
              try {
                await haalAllesOpnieuw()
                toast.ok('Alles is opnieuw opgehaald.')
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Opnieuw ophalen lukte niet')
              } finally {
                setBezigMetHerladen(false)
              }
            }}
          >
            {bezigMetHerladen
              ? <><Loader2 size={14} className="spin" /> Bezig…</>
              : <><RefreshCw size={14} /> Opnieuw ophalen</>}
          </button>
        </div>
      </div>

      <p className="inst-voet">
        Versie {version}. Wat je hier kiest staat op dit apparaat en reist niet
        mee naar je telefoon of een andere computer.
      </p>
    </Modal>
  )
}
