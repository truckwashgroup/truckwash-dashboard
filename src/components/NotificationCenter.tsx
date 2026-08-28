import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell, BellOff, BellRing, CalendarDays, CheckCheck, GraduationCap,
  Info, ListTodo, TriangleAlert,
} from 'lucide-react'
import { db } from '../lib/db'
import { notifications as notifyRepo } from '../lib/repo'
import type { AppNotification, NotificationKind } from '../lib/types'
import { relative } from '../lib/format'
import { useAuth } from '../store/useAuth'
import { useNav } from '../store/useNav'
import {
  notifyPermissionState, requestNotifyPermission, showDeviceNotification,
} from '../lib/notify'
import { toast } from '../store/useToasts'

const ICONS: Record<NotificationKind, typeof Info> = {
  info: Info,
  taak: ListTodo,
  waarschuwing: TriangleAlert,
  rooster: CalendarDays,
  opleiding: GraduationCap,
}

const TONE: Record<NotificationKind, string> = {
  info: 'var(--info)',
  taak: 'var(--brand)',
  waarschuwing: 'var(--warn)',
  rooster: 'var(--accent)',
  opleiding: 'var(--ok)',
}

/** Meldingen die voor deze gebruiker bedoeld zijn. */
export function useMyNotifications() {
  const user = useAuth((s) => s.user)
  return useLiveQuery(
    async () => {
      if (!user) return [] as AppNotification[]
      const all = await db.notifications.toArray()
      return all
        .filter((n) => n.toUserId === user.id || (n.toRole && user.roles.includes(n.toRole)))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 60)
    },
    [user?.id, user?.roles.join()],
    [] as AppNotification[],
  )
}

/**
 * Laat nieuwe meldingen ook buiten de app zien. Wat al binnen was bij het
 * opstarten wordt niet alsnog getoond, anders krijg je bij elke start een
 * regen van meldingen.
 */
export function useDeviceNotifications() {
  const items = useMyNotifications()
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!items.length) return
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id))
      return
    }
    for (const n of items) {
      if (seen.current.has(n.id)) continue
      seen.current.add(n.id)
      if (!n.readAt) void showDeviceNotification(n.title, n.body)
    }
  }, [items])
}

export default function NotificationCenter() {
  const user = useAuth((s) => s.user)
  const goto = useNav((s) => s.goto)
  const items = useMyNotifications()
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState(notifyPermissionState())
  const [pos, setPos] = useState({ top: 0, right: 0 })

  const bellRef = useRef<HTMLButtonElement>(null)
  const unread = items.filter((n) => !n.readAt)

  /**
   * Het paneel hangt in een portal onder <body>, niet in de balk zelf.
   * De hoofdkolom heeft namelijk overflow: hidden, en daarin werd het paneel
   * afgeknipt -- je zag dan alleen het bovenste randje.
   */
  const place = useCallback(() => {
    const r = bellRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  async function askPermission() {
    const result = await requestNotifyPermission()
    setPermission(result)
    if (result === 'granted') {
      toast.ok('Meldingen staan aan')
      void showDeviceNotification('Meldingen staan aan', 'Je krijgt voortaan berichten op dit apparaat.')
    } else if (result === 'denied') {
      toast.warn('Meldingen zijn geblokkeerd. Zet ze aan in de instellingen van je apparaat.')
    } else {
      toast.info('Dit apparaat ondersteunt meldingen buiten de app niet. In de app zie je ze wel.')
    }
  }

  async function openItem(n: AppNotification) {
    await notifyRepo.markRead(n.id)
    if (n.link) goto(n.link)
    setOpen(false)
  }

  if (!user) return null

  return (
    <>
      <button
        ref={bellRef}
        className={`notif-bell ${unread.length ? 'has-unread' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={unread.length ? `${unread.length} ongelezen` : 'Meldingen'}
        aria-label="Meldingen"
      >
        {unread.length ? <BellRing size={17} /> : <Bell size={17} />}
        {unread.length > 0 && <span className="dot">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              key="notif"
              className="notif-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: .12 }}
              onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
            >
              <motion.div
                className="notif-panel"
                style={{ top: pos.top, right: pos.right }}
                initial={{ opacity: 0, y: -8, scale: .98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: .98 }}
                transition={{ duration: .15 }}
              >
                <div className="notif-head">
                  <strong>Meldingen</strong>
                  {unread.length > 0 && <span className="badge brand">{unread.length} nieuw</span>}
                  <span style={{ flex: 1 }} />
                  {unread.length > 0 && (
                    <button
                      className="btn ghost sm"
                      onClick={() => void notifyRepo.markAllRead(user.id, user.roles)}
                    >
                      <CheckCheck size={14} /> Alles gelezen
                    </button>
                  )}
                </div>

                {permission !== 'granted' && (
                  <button className="notif-permission" onClick={() => void askPermission()}>
                    <BellOff size={15} />
                    <span>
                      <strong>Meldingen staan uit.</strong> Aanzetten zodat je berichten
                      ook ziet als de app dicht is.
                    </span>
                  </button>
                )}

                <div className="notif-list">
                  {items.length === 0 && <div className="notif-empty">Geen meldingen.</div>}
                  {items.map((n) => {
                    const Icon = ICONS[n.kind]
                    return (
                      <button
                        key={n.id}
                        className={`notif-item ${n.readAt ? '' : 'unread'}`}
                        onClick={() => void openItem(n)}
                      >
                        <span className="icon" style={{ color: TONE[n.kind] }}>
                          <Icon size={16} />
                        </span>
                        <span className="body">
                          <span className="t">{n.title}</span>
                          <span className="b">{n.body}</span>
                          <span className="m">
                            {n.fromName} · {relative(n.createdAt)}
                            {n.toRole ? ' · aan het hele team' : ''}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
