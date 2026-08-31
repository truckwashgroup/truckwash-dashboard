import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle, Loader2, RefreshCw, Trash2, Truck } from 'lucide-react'
import { useAuth } from './store/useAuth'
import { setSyncEnabled, startSyncEngine } from './lib/sync'
import { installErrorCapture, onCapturedError, trail } from './lib/trail'
import { logs as logRepo } from './lib/tickets'
import { useUpdates } from './lib/updates'
import { useNav } from './store/useNav'
import Login from './components/Login'
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
import ManagementDashboard from './dashboards/management/ManagementDashboard'

export default function App() {
  const { user, role, booting, restore } = useAuth()
  const initUpdates = useUpdates((s) => s.init)

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
    <>
      {!user ? (
        <Login />
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
      ) : role === 'customer' ? (
        <CustomerDashboard />
      ) : (
        <ManagementDashboard />
      )}

      <Toasts />
      <UpdateBanner />
    </>
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
