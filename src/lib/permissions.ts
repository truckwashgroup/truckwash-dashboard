import { PERMISSIONS, type Permission, type Role, type User } from './types'

/* ------------------------------------------------------------------ *
 *  Wat mag iemand?
 *
 *  Effectief = alles wat zijn rollen standaard geven,
 *              plus de losse rechten die het management heeft toegekend,
 *              min de rechten die zijn ingetrokken.
 *
 *  Intrekken wint altijd van toekennen. Dat is de veilige volgorde: als
 *  iemand per ongeluk twee rollen krijgt, blijft een bewuste intrekking staan.
 * ------------------------------------------------------------------ */

const EMPLOYEE: Permission[] = [
  'jobs.view', 'jobs.claim',
  'roster.viewOwn',
  'hours.own',
  'inventory.view', 'inventory.adjust',
  'expenses.submit',
  'learning.take',
  'locations.view',
  'agenda.view',
  // Iedereen op de vloer moet een storing kunnen melden; dat is precies wie
  // hem als eerste ziet.
  'assets.view', 'faults.report',
  // Iedereen mag melden dat de app iets raars doet -- dat is precies wie het
  // als eerste merkt.
  'dev.report',
  // Overleggen doet iedereen op de vloer; dat is de vervanger van de
  // groepsapp waar niemand grip op had.
  'chat.use',
  // Afrekenen hoort bij het werk op de vloer: wie de wasbeurt doet, doet
  // ook de balie. Korting geven, crediteren en de lade tellen niet -- daar
  // moet iemand met verantwoordelijkheid bij staan.
  'pos.use',
]

const TECHNICIAN: Permission[] = [
  'dev.report',
  'chat.use',
  'agenda.view', 'agenda.edit',
  'roster.viewOwn',
  'hours.own',
  'expenses.submit',
  'learning.take',
  'locations.view',
  'inventory.view', 'inventory.adjust',
  'assets.view', 'assets.manage',
  'faults.report', 'faults.view', 'faults.triage',
  'workorders.view', 'workorders.create', 'workorders.assign', 'workorders.complete',
  'maintenance.view', 'maintenance.manage',
]

const DEVELOPER: Permission[] = [
  'locations.view', 'locations.all',
  'chat.use',
  'mail.read', 'mail.send',
  'dev.report', 'dev.tickets', 'dev.respond', 'dev.logs',
  'admin.audit',
]

const SUPERVISOR: Permission[] = [
  ...EMPLOYEE,
  'faults.view', 'faults.triage',
  'workorders.view', 'workorders.create',
  'maintenance.view',
  'jobs.edit', 'jobs.assign', 'jobs.cancel',
  'planning.view', 'planning.edit',
  'roster.viewTeam', 'roster.edit', 'roster.publish',
  'hours.viewTeam', 'hours.approve',
  'inventory.manage',
  'expenses.viewTeam',
  'staff.view',
  'staff.request',
  'customers.view',
  'notify.send', 'notify.broadcast',
  'learning.assign',
  'chat.manage',
  'agenda.edit',
  'pos.discount', 'pos.refund', 'pos.cash',
]

/**
 * Een werkgever ziet zijn eigen bedrijf en verder niets van Truckwash1.
 * Geen rooster, geen voorraad, geen collega's -- alleen zijn chauffeurs, hun
 * wasbeurten en de afspraken die daarover gemaakt zijn.
 */
const EMPLOYER: Permission[] = [
  'employer.view', 'employer.staff', 'employer.rules',
  'jobs.view',
  'chat.use',
  'dev.report',
]

const CUSTOMER: Permission[] = [
  // Een klant ziet alleen zijn eigen omgeving; die schermen vragen geen
  // losse rechten, de database schermt de gegevens al af.
]

/**
 * De administratie.
 *
 * Alles wat op een beslissing wacht komt bij deze rol samen: kostenposten,
 * urenwijzigingen, aanpassingen in een dossier en aanmeldingen. De rode
 * draad is niet "geld" maar "iemand moet hier ja of nee zeggen".
 *
 * Wat er bewust níét bij zit: het rooster maken, de planning, de voorraad en
 * de techniek. Dat is uitvoeren, en wie uitvoert hoort niet ook zijn eigen
 * werk goed te keuren.
 *
 * Wel finance.view, want een kostenpost beoordelen zonder te zien wat er
 * verder die maand is langsgekomen is stempelen, geen beoordelen.
 */
const ADMINISTRATIE: Permission[] = [
  'admin.desk',

  'expenses.viewTeam', 'expenses.approve', 'expenses.read', 'expenses.submit',
  'finance.view', 'finance.export',

  'hours.own', 'hours.viewTeam', 'hours.approve',
  'roster.viewOwn', 'roster.viewTeam',

  'staff.view', 'staff.edit', 'staff.pay',
  'signups.view', 'signups.decide',

  'customers.view', 'customers.manage',
  'employer.view',

  'locations.view', 'locations.all',
  'mail.read', 'mail.send',
  'agenda.view', 'agenda.edit',
  'notify.send',
  'chat.use',
  'learning.take',
  'dev.report',
]

const MANAGEMENT: Permission[] = PERMISSIONS.map((p) => p.key)

export const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  employee: EMPLOYEE,
  supervisor: SUPERVISOR,
  technician: TECHNICIAN,
  developer: DEVELOPER,
  employer: EMPLOYER,
  customer: CUSTOMER,
  administratie: ADMINISTRATIE,
  management: MANAGEMENT,
}

/** Wat de rollen van deze gebruiker standaard geven. */
export function baseFor(roles: Role[]): Set<Permission> {
  const out = new Set<Permission>()
  for (const r of roles) for (const p of ROLE_DEFAULTS[r] ?? []) out.add(p)
  return out
}

/** Alles wat deze gebruiker daadwerkelijk mag. */
export function effectivePermissions(user: User | null): Set<Permission> {
  if (!user || !user.active) return new Set()
  const set = baseFor(user.roles)
  for (const p of user.grants ?? []) set.add(p)
  for (const p of user.revokes ?? []) set.delete(p)
  return set
}

export function can(user: User | null, permission: Permission): boolean {
  return effectivePermissions(user).has(permission)
}

export function canAny(user: User | null, permissions: Permission[]): boolean {
  const set = effectivePermissions(user)
  return permissions.some((p) => set.has(p))
}

/**
 * Waar een recht vandaan komt. De rechtenpagina laat dit zien, zodat je ziet
 * of iets van de rol komt of met de hand is gezet.
 */
export type PermissionSource = 'rol' | 'toegekend' | 'ingetrokken' | 'geen'

export function sourceOf(user: User, permission: Permission): PermissionSource {
  if (user.revokes?.includes(permission)) return 'ingetrokken'
  if (user.grants?.includes(permission)) return 'toegekend'
  return baseFor(user.roles).has(permission) ? 'rol' : 'geen'
}

/**
 * Zet één recht aan of uit voor een gebruiker en geeft de nieuwe lijsten terug.
 *
 * De truc: we slaan alleen de afwijking op. Staat een recht al in de rol en
 * zet je het aan, dan hoeft er niets bij. Zet je het uit, dan komt het in
 * revokes. Zo blijft een later gewijzigde rol gewoon doorwerken.
 */
export function togglePermission(
  user: Pick<User, 'roles' | 'grants' | 'revokes'>,
  permission: Permission,
  enabled: boolean,
): { grants: Permission[]; revokes: Permission[] } {
  const fromRole = baseFor(user.roles).has(permission)
  const grants = new Set(user.grants ?? [])
  const revokes = new Set(user.revokes ?? [])

  grants.delete(permission)
  revokes.delete(permission)

  if (enabled && !fromRole) grants.add(permission)
  if (!enabled && fromRole) revokes.add(permission)

  return { grants: [...grants], revokes: [...revokes] }
}

/**
 * Voorkomt dat iemand zichzelf buitensluit: het laatste account dat rechten
 * mag uitdelen kan dat recht niet kwijtraken.
 */
export function wouldLockOut(
  allUsers: User[],
  target: User,
  next: { grants: Permission[]; revokes: Permission[] },
): boolean {
  const stillAdmin = allUsers.filter((u) => {
    if (!u.active) return false
    if (u.id === target.id) {
      return effectivePermissions({ ...u, ...next }).has('staff.permissions')
    }
    return effectivePermissions(u).has('staff.permissions')
  })
  return stillAdmin.length === 0
}

/** De rechten gegroepeerd, in de volgorde waarin ze getoond worden. */
export function groupedPermissions() {
  const groups = new Map<string, typeof PERMISSIONS>()
  for (const p of PERMISSIONS) {
    const list = groups.get(p.group) ?? []
    list.push(p)
    groups.set(p.group, list)
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }))
}
