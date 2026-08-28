import { motion } from 'framer-motion'
import { ArrowRight, BarChart3, Building2, HardHat, LogOut, ShieldCheck } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import type { Role } from '../lib/types'
import SyncPill from './SyncPill'
import Logo from './Logo'

const CARDS: Record<Role, {
  title: string
  text: string
  icon: typeof HardHat
  cls?: string
}> = {
  employee: {
    title: 'Werknemers',
    text: 'Wasopdrachten van vandaag, wagens afmelden, uren en materiaalverbruik registreren.',
    icon: HardHat,
  },
  customer: {
    title: 'Klanten',
    text: 'Wasbeurt inplannen, de status van je wagens volgen en je historie en facturen inzien.',
    icon: Building2,
  },
  management: {
    title: 'Management',
    text: 'Omzet, bezetting en doorlooptijd, personeel, voorraad en het valideren van kosten.',
    icon: BarChart3,
    cls: 'mgmt',
  },
}

const ORDER: Role[] = ['employee', 'customer', 'management']

export default function RolePicker() {
  const { user, chooseRole, logout } = useAuth()
  if (!user) return null

  const roles = ORDER.filter((r) => user.roles.includes(r))
  const hasManagement = user.roles.includes('management')

  return (
    <div className="role-screen">
      <div className="role-inner">
        <motion.div
          className="role-head"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .3 }}
        >
          <Logo width={210} className="role-logo" />
          <h1>Waar wil je heen, {user.name.split(' ')[0]}?</h1>
          <p>
            Kies het dashboard dat je nodig hebt. Je kunt later altijd wisselen
            via het menu linksonder.
          </p>
        </motion.div>

        <div className="role-grid">
          {roles.map((role, i) => {
            const c = CARDS[role]
            const Icon = c.icon
            return (
              <motion.button
                key={role}
                className={`role-card ${c.cls ?? ''}`}
                onClick={() => chooseRole(role)}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: .34, delay: .08 + i * 0.09, ease: [.22, .61, .36, 1] }}
              >
                <div className="icon"><Icon size={25} /></div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
                <div className="go">
                  Openen <ArrowRight size={15} />
                </div>
                {role === 'management' && (
                  <span className="badge brand" style={{ position: 'absolute', top: 18, right: 18 }}>
                    <ShieldCheck size={12} /> Extra rechten
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>

        <motion.div
          className="role-foot"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: .45 }}
        >
          <span>
            Ingelogd als <strong style={{ color: 'var(--text-2)' }}>{user.email}</strong>
          </span>
          <SyncPill />
          {!hasManagement && (
            <span>Het managementdashboard is zichtbaar zodra je die rechten hebt.</span>
          )}
          <button className="btn ghost sm" onClick={() => void logout()}>
            <LogOut size={14} /> Uitloggen
          </button>
        </motion.div>
      </div>
    </div>
  )
}
