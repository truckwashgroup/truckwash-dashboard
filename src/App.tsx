import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Loader2, Truck } from 'lucide-react'
import { useAuth } from './store/useAuth'
import { setSyncEnabled, startSyncEngine } from './lib/sync'
import { useUpdates } from './lib/updates'
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
import ManagementDashboard from './dashboards/management/ManagementDashboard'

export default function App() {
  const { user, role, booting, restore } = useAuth()
  const initUpdates = useUpdates((s) => s.init)

  /** De wasstraat-animatie draait één keer per inlog. */
  const [washed, setWashed] = useState(false)

  // Nieuwe berichten ook buiten de app laten zien
  useDeviceNotifications()

  useEffect(() => {
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
