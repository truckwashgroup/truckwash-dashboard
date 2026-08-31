import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import { AlertTriangle, Loader2, RefreshCw, Trash2, Truck } from 'lucide-react'
import { useAuth } from './store/useAuth'
import { effectivePermissions } from './lib/permissions'
import { setSyncEnabled, startSyncEngine } from './lib/sync'
import { installErrorCapture, onCapturedError, trail } from './lib/trail'
import { logs as logRepo } from './lib/tickets'
import { useUpdates } from './lib/updates'
import { useNav } from './store/useNav'
import { useTheme } from './lib/theme'
import { feliciteer } from './lib/agenda'
import Login from './components/Login'
import WachtwoordWijzigen from './components/WachtwoordWijzigen'
import CarwashAnimation from './components/CarwashAnimation'
import RolePicker from './components/RolePicker'
import Toasts from './components/Toasts'
import UpdateBanner from './components/UpdateBanner'
import { useDeviceNotifications } from './components/NotificationCenter'
import EmployeeDashboard from './dashboards/employee/EmployeeDashboard'
import CustomerDashboard from './dashboards/customer/CustomerDashboard'
import SupervisorDashboard from './dashboards/supervisor/SupervisorDashboard'
import TechnicianDashboard from './dashboards/technician/TechnicianDashboard'
import DeveloperDashboard from './dashboards/developer/DeveloperDashboard'
import EmployerDashboard from './dashboards/employer/EmployerDashboard'
import RondleidingPoort from './components/RondleidingPoort'
import ManagementDashboard from './dashboards/management/ManagementDashboard'

export default function App() {
  const { user, role, booting, restore } = useAuth()
  const initUpdates = useUpdates((s) => s.init)
  const rustig = useTheme((s) => s.rustig)

  /** De wasstraat-animatie draait één keer per inlog. */
  const [washed, setWashed] = useState(false)

  // Nieuwe berichten ook buiten de app laten zien
  useDeviceNotifications()

  /**
   * Duurt het opstarten te lang, dan zeggen we dat ook.
   *
   * Aanleiding: op Android bleef de app hangen op het laadscherm en was er
   * niets te zien waar je iets mee kon. Een scherm dat blijft draaien is het
   * ergste wat een app kan doen -- dan weet niemand of hij moet wachten of
   * opnieuw moet beginnen.
   */
  const [traag, setTraag] = useState(false)

  useEffect(() => {
    if (!booting) return
    const t = setTimeout(() => setTraag(true), 6000)
    return () => clearTimeout(t)
  }, [booting])

  useEffect(() => {
    // Fouten opvangen voordat er iets anders start, anders missen we juist
    // de problemen die tijdens het opstarten optreden.
    installErrorCapture()
    onCapturedError((e) => {
      // Nooit awaiten en nooit laten omvallen: het logboek mag het opstarten
      // niet in de weg zitten.
      void Promise.resolve(logRepo.record({
        level: e.level,
        message: e.message,
        stack: e.stack,
        page: useNav.getState().target?.page,
        appVersion: useUpdates.getState().version,
        user: useAuth.getState().user ?? undefined,
      })).catch(() => {})
    })

    // Pas synchroniseren als er een sessie is; restore() zet hem aan.
    setSyncEnabled(false)
    startSyncEngine()
    void initUpdates()
    void restore()
  }, [initUpdates, restore])

  // opnieuw inloggen -> animatie opnieuw
  useEffect(() => {
    if (!user) setWashed(false)
  }, [user])

  /*
   * Verjaardagen, jubilea en eerste werkdagen.
   *
   * Een verjaardag die niemand opmerkt is erger dan geen verjaardag in het
   * systeem. Dit kijkt na het inloggen of er vandaag iets te vieren valt.
   *
   * Het id van zo'n bericht ligt vast op persoon en jaar, dus doen tien
   * apparaten dit tegelijk, dan staat er één felicitatie -- de rest schrijft
   * dezelfde regel over. Alleen wie het personeel mag zien doet de moeite;
   * de rest heeft de gegevens toch niet.
   */
  useEffect(() => {
    if (!user || !washed) return
    if (!effectivePermissions(user).has('staff.view')) return

    const t = setTimeout(() => {
      void feliciteer(user).then((aantal) => {
        if (aantal > 0) {
          console.info(`[agenda] ${aantal} felicitatie(s) verstuurd`)
        }
      }).catch(() => { /* een felicitatie mag nooit iets breken */ })
    }, 4000)

    return () => clearTimeout(t)
  }, [user, washed])

  if (booting) {
    return (
      <div className="boot">
        <Truck size={34} color="var(--brand)" />
        <div className="row" style={{ gap: 8 }}>
          <Loader2 size={15} className="spin" />
          Gegevens laden…
        </div>

        {traag && (
          <div className="boot-traag">
            <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
              <AlertTriangle size={17} />
              <span>
                Dit duurt langer dan het hoort. Meestal komt dat door de lokale
                gegevens op dit apparaat.
              </span>
            </div>
            <div className="row" style={{ gap: 7, marginTop: 12 }}>
              <button className="btn sm" onClick={() => window.location.reload()}>
                <RefreshCw size={14} /> Opnieuw proberen
              </button>
              <button className="btn danger sm" onClick={() => void wisLokaleGegevens()}>
                <Trash2 size={14} /> Gegevens wissen en opnieuw
              </button>
            </div>
            <p>
              Wissen verwijdert alleen wat op dit apparaat staat. Alles wat al
              verstuurd is blijft op de server; je moet daarna wel opnieuw
              inloggen.
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    /*
     * De keuze "rustige beweging" moet ook gelden voor wat framer-motion
     * doet, en dat gaat niet via CSS: dat animeert stijlen vanuit JavaScript.
     * Hiermee luistert elke beweging in de app naar dezelfde knop.
     */
    <MotionConfig reducedMotion={rustig ? 'always' : 'never'}>
      {!user ? (
        <Login />
      ) : user.mustChangePassword ? (
        /*
         * Uitgenodigd met een tijdelijk wachtwoord uit een mail. Verder komt
         * hij niet tot hij zelf iets kiest -- overslaan zou betekenen dat het
         * bij een deel van de mensen blijft staan, en juist bij dat deel gaat
         * het mis.
         */
        <WachtwoordWijzigen />
      ) : !washed ? (
        <AnimatePresence>
          <CarwashAnimation key="wash" onDone={() => setWashed(true)} userName={user.name} />
        </AnimatePresence>
      ) : !role ? (
        <RolePicker />
      ) : role === 'employee' ? (
        <EmployeeDashboard />
      ) : role === 'supervisor' ? (
        <SupervisorDashboard />
      ) : role === 'technician' ? (
        <TechnicianDashboard />
      ) : role === 'developer' ? (
        <DeveloperDashboard />
      ) : role === 'employer' ? (
        <EmployerDashboard />
      ) : role === 'customer' ? (
        <CustomerDashboard />
      ) : (
        <ManagementDashboard />
      )}

      {/*
        * De rondleiding komt over het dashboard heen te liggen, niet ervoor.
        * Dat moet ook: de aanwijzers wijzen naar knoppen die er dan al staan.
        */}
      {role && washed && !user?.mustChangePassword && <RondleidingPoort rol={role} />}

      <Toasts />
      <UpdateBanner />
    </MotionConfig>
  )
}

/**
 * Laatste redmiddel als de lokale opslag stuk is: alles weggooien en opnieuw
 * beginnen. Wat al verstuurd was staat op de server, dus dat komt terug.
 */
async function wisLokaleGegevens() {
  try {
    const namen = (await indexedDB.databases?.()) ?? []
    for (const d of namen) if (d.name) indexedDB.deleteDatabase(d.name)
    // Ook de naam die we zeker kennen, voor browsers zonder databases().
    indexedDB.deleteDatabase('truckwash-client')
    localStorage.clear()
  } catch {
    /* niets aan te doen; we herladen sowieso */
  }
  window.location.reload()
}
