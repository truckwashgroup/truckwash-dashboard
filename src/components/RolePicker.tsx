import { motion } from 'framer-motion'
import {
  ArrowRight, BarChart3, Briefcase, Building2, ClipboardList, Code2, FileCheck, HardHat,
  LogOut, Mic, Search, ShieldCheck, Warehouse, Wrench,
} from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useNav } from '../store/useNav'
import { ROLE_ORDER, type Role } from '../lib/types'
import { voiceSupported, voiceUnavailableReason } from '../lib/voice'
import { toast } from '../store/useToasts'
import SyncPill from './SyncPill'
import Logo from './Logo'
import GlobalSearch from './GlobalSearch'
import { useSync } from '../lib/sync'
import '../styles/rolzoek.css'

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
  supervisor: {
    title: 'Leidinggevende',
    text: 'Je team aansturen: rooster maken, uren goedkeuren, berichten sturen en de dagbezetting bewaken.',
    icon: ClipboardList,
    cls: 'lead',
  },
  technician: {
    title: 'Technische dienst',
    text: 'Storingen afhandelen, onderhoud plannen, werkbonnen afronden en het machinepark beheren.',
    icon: Wrench,
    cls: 'tech',
  },
  developer: {
    title: 'Ontwikkeling',
    text: 'Meldingen uit de app afhandelen, het logboek doorspitten en zien wat gebruikers deden voordat er iets misging.',
    icon: Code2,
    cls: 'dev',
  },
  administratie: {
    title: 'Administratie',
    text: 'Alles wat op een beslissing wacht: kostenposten met de factuur erbij, urenwijzigingen, dossieraanpassingen en aanmeldingen.',
    icon: FileCheck,
    cls: 'admin',
  },
  customer: {
    /*
     * Heette 'Klanten', net als het scherm waar het management de bedrijven
     * beheert. Twee dingen met dezelfde naam is er een te veel, en dit is de
     * kant die uitgenodigd wordt: iemand van een klant die zelf inlogt.
     */
    title: 'Klanten (uitgenodigd)',
    text: 'Wasbeurt inplannen, de status van je wagens volgen en je historie en facturen inzien.',
    icon: Building2,
  },
  employer: {
    title: 'Werkgever',
    text: 'Je chauffeurs beheren, zien wat er gewassen is, en vastleggen wat er per wagen wel en niet afgenomen mag worden.',
    icon: Briefcase,
    cls: 'werkgever',
  },
  trucksupply: {
    title: 'Trucksshop',
    text: 'Voorraad per vestiging, alarmen, artikelen tot in de kassa, bestellingen met pakbon en verzendlabel.',
    icon: Warehouse,
    cls: 'supply',
  },
  management: {
    title: 'Management',
    text: 'Omzet, bezetting en doorlooptijd, personeel, voorraad en het valideren van kosten.',
    icon: BarChart3,
    cls: 'mgmt',
  },
}

/*
 * De volgorde komt uit types.ts en staat hier niet nog een keer.
 *
 * Hier stond een eigen lijstje, en dat liep uit de pas: toen de rol
 * administratie erbij kwam, kreeg die wel een kaart en wel rechten, maar
 * stond hij niet in dit rijtje -- en dan bestaat het dashboard wel en is het
 * nergens te kiezen. TypeScript zag het niet: een onvolledige lijst is een
 * geldige Role[], alleen een onvolledige Record<Role, ...> valt op.
 */
const ORDER: Role[] = ROLE_ORDER

export default function RolePicker() {
  const { user, chooseRole, logout } = useAuth()
  const openSearch = useNav((s) => s.openSearch)
  const syncing = useSync((s) => s.syncing)
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
            Kies het dashboard dat je nodig hebt, of zoek meteen wat je zoekt.
            Je kunt later altijd wisselen via het menu linksonder.
          </p>
        </motion.div>

        {/*
          * De zoekbalk staat hier omdat het keuzescherm anders een extra klik
          * is voor wie al weet waar hij heen wil. De balk doorzoekt alle
          * dashboards die deze gebruiker heeft en opent het juiste; het
          * paneel zelf (GlobalSearch, onderaan) regelt ook Ctrl+K.
          */}
        <motion.div
          className="rolzoek"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .3, delay: .06 }}
        >
          <button
            className="rolzoek-knop"
            onClick={() => openSearch(false)}
            title="Zoeken (Ctrl+K)"
          >
            <Search size={19} />
            <span className="label">Zoek een scherm, kenteken, klant of medewerker…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            className={`rolzoek-mic ${voiceSupported() ? '' : 'off'}`}
            onClick={() =>
              voiceSupported() ? openSearch(true) : toast.info(voiceUnavailableReason())
            }
            title={voiceSupported() ? 'Zoeken met je stem' : voiceUnavailableReason()}
            aria-label="Zoeken met je stem"
          >
            <Mic size={19} />
          </button>
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
          {syncing && <span>Gegevens worden opgehaald…</span>}
          <SyncPill />
          {!hasManagement && (
            <span>Het managementdashboard is zichtbaar zodra je die rechten hebt.</span>
          )}
          <button className="btn ghost sm" onClick={() => void logout()}>
            <LogOut size={14} /> Uitloggen
          </button>
        </motion.div>
      </div>

      {/* Het zoekpaneel; zonder rol doorzoekt het alle dashboards van deze gebruiker. */}
      <GlobalSearch />
    </div>
  )
}
