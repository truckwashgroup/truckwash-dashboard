import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, RotateCcw, ShieldCheck, ShieldX, Undo2 } from 'lucide-react'
import { db } from '../lib/db'
import { users as userRepo } from '../lib/repo'
import {
  PERMISSION_GROUPS, PERMISSIONS, ROLE_LABELS, ROLE_ORDER,
  type Permission, type Role, type User,
} from '../lib/types'
import {
  effectivePermissions, groupedPermissions, sourceOf, togglePermission, wouldLockOut,
} from '../lib/permissions'
import { Badge, Field } from './ui'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Rechten van één persoon
 *
 *  De rollen zetten de basis; daarnaast kun je elk recht los aan- of
 *  uitzetten. We slaan alleen de afwijking op, zodat een latere wijziging in
 *  wat een rol betekent gewoon blijft doorwerken.
 * ------------------------------------------------------------------ */

export default function PermissionEditor({
  person,
  onClose,
}: {
  person: User
  onClose?: () => void
}) {
  const allUsers = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const [confirm, setConfirm] = useState<Permission | null>(null)

  const effective = useMemo(() => effectivePermissions(person), [person])
  const groups = useMemo(() => groupedPermissions(), [])

  const afwijkingen = (person.grants?.length ?? 0) + (person.revokes?.length ?? 0)

  async function setRole(role: Role, on: boolean) {
    const roles = on
      ? [...new Set([...person.roles, role])]
      : person.roles.filter((r) => r !== role)

    if (roles.length === 0) return toast.error('Kies minimaal één rol')

    const next = { grants: person.grants ?? [], revokes: person.revokes ?? [] }
    if (wouldLockOut(allUsers, { ...person, roles }, next)) {
      return toast.error('Dit is het laatste account dat rechten mag uitdelen. Geef eerst iemand anders dat recht.')
    }

    await userRepo.setRoles(person.id, roles)
    toast.ok(`${ROLE_LABELS[role]} ${on ? 'toegekend' : 'ingetrokken'}`)
  }

  async function toggle(permission: Permission, on: boolean) {
    const next = togglePermission(person, permission, on)

    if (!on && permission === 'staff.permissions' && wouldLockOut(allUsers, person, next)) {
      return toast.error('Dan kan niemand meer rechten uitdelen. Geef dit recht eerst aan iemand anders.')
    }

    await userRepo.setPermissions(person.id, next.grants, next.revokes)
    setConfirm(null)
  }

  async function resetAll() {
    await userRepo.setPermissions(person.id, [], [])
    toast.info('Terug naar wat de rollen standaard geven')
  }

  return (
    <div>
      <Field label="Rollen" help="Bepalen de basis. Daaronder stel je per recht bij.">
        <div className="row" style={{ gap: 6 }}>
          {ROLE_ORDER.map((role) => {
            const on = person.roles.includes(role)
            return (
              <button
                key={role}
                type="button"
                className={`btn sm ${on ? 'primary' : ''}`}
                onClick={() => void setRole(role, !on)}
              >
                {role === 'management' && <ShieldCheck size={13} />}
                {ROLE_LABELS[role]}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="row" style={{ margin: '4px 0 14px', gap: 8 }}>
        <Badge tone="brand">{effective.size} van {PERMISSIONS.length} rechten</Badge>
        {afwijkingen > 0 ? (
          <>
            <Badge tone="warn">{afwijkingen} handmatige afwijking{afwijkingen === 1 ? '' : 'en'}</Badge>
            <button className="btn ghost sm" onClick={() => void resetAll()}>
              <RotateCcw size={13} /> Terug naar de rol
            </button>
          </>
        ) : (
          <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
            Volgt precies de rollen
          </span>
        )}
      </div>

      <div className="perm-groups">
        {groups.map(({ group, items }) => (
          <div key={group} className="perm-group">
            <div className="perm-group-head">{group}</div>
            {items.map((meta) => {
              const on = effective.has(meta.key)
              const source = sourceOf(person, meta.key)
              const needsConfirm = meta.sensitive && !on

              return (
                <div key={meta.key} className={`perm-row ${on ? 'on' : ''}`}>
                  <button
                    className={`perm-switch ${on ? 'on' : ''}`}
                    onClick={() => {
                      if (needsConfirm) setConfirm(meta.key)
                      else void toggle(meta.key, !on)
                    }}
                    aria-pressed={on}
                    title={on ? 'Uitzetten' : 'Aanzetten'}
                  >
                    <span className="knob" />
                  </button>

                  <div className="perm-text">
                    <div className="perm-label">
                      {meta.label}
                      {meta.sensitive && (
                        <span className="perm-sensitive" title="Gevoelig recht">
                          <AlertTriangle size={11} />
                        </span>
                      )}
                    </div>
                    <div className="perm-hint">{meta.hint}</div>

                    {confirm === meta.key && (
                      <div className="perm-confirm">
                        <span>
                          <strong>{meta.label}</strong> is een gevoelig recht. Weet je het zeker?
                        </span>
                        <button className="btn primary sm" onClick={() => void toggle(meta.key, true)}>
                          Ja, toekennen
                        </button>
                        <button className="btn ghost sm" onClick={() => setConfirm(null)}>
                          Annuleren
                        </button>
                      </div>
                    )}
                  </div>

                  <span className={`perm-source ${source}`}>
                    {source === 'rol' && 'via rol'}
                    {source === 'toegekend' && 'extra'}
                    {source === 'ingetrokken' && (
                      <>
                        <ShieldX size={10} /> ingetrokken
                      </>
                    )}
                  </span>

                  {(source === 'toegekend' || source === 'ingetrokken') && (
                    <button
                      className="perm-undo"
                      title="Terug naar wat de rol geeft"
                      onClick={() => {
                        const grants = (person.grants ?? []).filter((p) => p !== meta.key)
                        const revokes = (person.revokes ?? []).filter((p) => p !== meta.key)
                        void userRepo.setPermissions(person.id, grants, revokes)
                      }}
                    >
                      <Undo2 size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {onClose && (
        <div className="row end" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onClose}>Klaar</button>
        </div>
      )}
    </div>
  )
}

/** Kleine samenvatting voor in een lijst. */
export function PermissionSummary({ user }: { user: User }) {
  const effective = effectivePermissions(user)
  const afwijkingen = (user.grants?.length ?? 0) + (user.revokes?.length ?? 0)
  return (
    <span style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
      {effective.size} rechten
      {afwijkingen > 0 && ` · ${afwijkingen} afwijking${afwijkingen === 1 ? '' : 'en'}`}
    </span>
  )
}

export { PERMISSION_GROUPS }
