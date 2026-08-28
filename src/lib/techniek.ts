import { db, uid } from './db'
import { enqueue } from './sync'
import { notifications } from './repo'
import {
  MAINTENANCE_DAYS,
  type Asset, type AssetCategory, type AssetStatus, type Fault,
  type FaultSeverity, type FaultStatus, type MaintenanceInterval,
  type MaintenancePlan, type User, type WorkOrder, type WorkOrderPart,
  type WorkOrderPriority, type WorkOrderStatus, type WorkOrderType,
} from './types'

const DAY = 86_400_000

/* ------------------------------------------------------------------ *
 *  Technische dienst
 *
 *  Alles loopt via dezelfde weg als de rest van de app: eerst lokaal
 *  opslaan, dan de outbox, dan de server. Een monteur in een machinekamer
 *  heeft zelden bereik, en die moet gewoon door kunnen werken.
 * ------------------------------------------------------------------ */

async function put<T extends { id: string; updatedAt?: number }>(
  entity: Parameters<typeof enqueue>[0],
  table: { put: (v: T) => Promise<unknown> },
  record: T,
) {
  const stamped = { ...record, updatedAt: Date.now() }
  await table.put(stamped)
  await enqueue(entity, 'put', record.id, stamped)
  return stamped
}

/** Volgnummer in de vorm S-2601-0042 of W-2601-0042. */
function nextNumber(prefix: string, existing: number): string {
  const d = new Date()
  const jaarMaand = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0')
  return `${prefix}-${jaarMaand}-${String(existing + 1).padStart(4, '0')}`
}

/**
 * De sleutel die in een QR-code komt.
 *
 * Bewust niet het interne id: een label kan worden vervangen zonder dat de
 * historie eraan verandert, en wie een sticker fotografeert leest geen
 * database-id mee.
 */
export function makeQrToken(): string {
  const alfabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // zonder I, O, 0, 1
  let out = ''
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  for (const b of bytes) out += alfabet[b % alfabet.length]
  return out.slice(0, 4) + '-' + out.slice(4, 7) + '-' + out.slice(7, 10)
}

/* ---------------------------- Installaties ------------------------ */

export const assets = {
  async create(input: {
    locationId: string
    name: string
    category: AssetCategory
    code?: string
    brand?: string
    model?: string
    serialNumber?: string
    installedAt?: number
    warrantyUntil?: number
    location?: string
    notes?: string
  }) {
    const bestaande = await db.assets.where('locationId').equals(input.locationId).count()
    const loc = await db.locations.get(input.locationId)
    const prefix = (loc?.code ?? 'TW').replace('TW-', '')

    const asset: Asset = {
      id: uid('as'),
      locationId: input.locationId,
      code: input.code?.trim() ||
        `${prefix}-${input.category.slice(0, 3).toUpperCase()}-${String(bestaande + 1).padStart(2, '0')}`,
      name: input.name.trim(),
      category: input.category,
      brand: input.brand?.trim() || undefined,
      model: input.model?.trim() || undefined,
      serialNumber: input.serialNumber?.trim() || undefined,
      status: 'in bedrijf',
      installedAt: input.installedAt,
      warrantyUntil: input.warrantyUntil,
      location: input.location?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      qrToken: makeQrToken(),
      updatedAt: Date.now(),
    }
    return put('assets', db.assets, asset)
  },

  async update(id: string, patch: Partial<Asset>) {
    const asset = await db.assets.get(id)
    if (!asset) return
    return put('assets', db.assets, { ...asset, ...patch, id })
  },

  async setStatus(id: string, status: AssetStatus) {
    return assets.update(id, { status })
  },

  /** Nieuw label: nieuwe sleutel, zelfde apparaat en zelfde historie. */
  async regenerateQr(id: string) {
    return assets.update(id, { qrToken: makeQrToken() })
  },

  async byQr(token: string): Promise<Asset | undefined> {
    const schoon = token.trim().toUpperCase()
    return db.assets.where('qrToken').equals(schoon).first()
  },

  /** Zoekt op QR-sleutel of op de leesbare code op het label. */
  async find(codeOrToken: string): Promise<Asset | undefined> {
    const schoon = codeOrToken.trim().toUpperCase()
    return (
      (await db.assets.where('qrToken').equals(schoon).first()) ??
      (await db.assets.where('code').equals(schoon).first())
    )
  },
}

/* ------------------------------ Storingen ------------------------- */

export const faults = {
  async report(input: {
    locationId: string
    assetId?: string
    assetName?: string
    title: string
    description: string
    severity: FaultSeverity
    stopsProduction: boolean
    by: Pick<User, 'id' | 'name'>
  }) {
    const aantal = await db.faults.count()
    const fault: Fault = {
      id: uid('st'),
      number: nextNumber('S', aantal),
      locationId: input.locationId,
      assetId: input.assetId,
      assetName: input.assetName,
      title: input.title.trim(),
      description: input.description.trim(),
      severity: input.severity,
      status: 'gemeld',
      stopsProduction: input.stopsProduction,
      reportedBy: input.by.id,
      reportedByName: input.by.name,
      reportedAt: Date.now(),
      updatedAt: Date.now(),
    }

    await put('faults', db.faults, fault)

    // Een apparaat dat stilligt hoort dat ook te laten zien in het overzicht.
    if (input.assetId && (input.severity === 'kritiek' || input.stopsProduction)) {
      await assets.setStatus(input.assetId, 'storing')
    }

    // De technische dienst van die vestiging op de hoogte brengen.
    const technici = (await db.users.toArray()).filter(
      (u) => u.active && u.roles.includes('technician') &&
        (u.allLocations || u.locationId === input.locationId || (u.manages ?? []).includes(input.locationId)),
    )
    for (const t of technici) {
      await notifications.send({
        to: { id: t.id, name: t.name },
        from: input.by,
        kind: input.severity === 'kritiek' ? 'waarschuwing' : 'taak',
        title: `${fault.number}: ${fault.title}`,
        body:
          `${input.assetName ?? 'Onbekend apparaat'} — ${input.severity}` +
          (input.stopsProduction ? ' — installatie ligt stil' : ''),
        link: 'storingen',
      })
    }

    return fault
  },

  async update(id: string, patch: Partial<Fault>) {
    const fault = await db.faults.get(id)
    if (!fault) return
    return put('faults', db.faults, { ...fault, ...patch, id })
  },

  async setStatus(id: string, status: FaultStatus, by: Pick<User, 'id' | 'name'>, resolution?: string) {
    const fault = await db.faults.get(id)
    if (!fault) return

    const patch: Partial<Fault> = { status }
    if (status === 'opgelost') {
      patch.resolvedAt = Date.now()
      patch.resolution = resolution
      patch.downtimeMinutes = Math.round((Date.now() - fault.reportedAt) / 60000)
      if (fault.assetId) await assets.setStatus(fault.assetId, 'in bedrijf')
    }
    if (status === 'afgewezen') {
      patch.resolvedAt = Date.now()
      patch.resolution = resolution
      if (fault.assetId) await assets.setStatus(fault.assetId, 'in bedrijf')
    }

    const bijgewerkt = await faults.update(id, patch)

    // De melder hoort te horen wat ermee gebeurd is.
    if (status === 'opgelost' || status === 'afgewezen') {
      const melder = await db.users.get(fault.reportedBy)
      if (melder && melder.id !== by.id) {
        await notifications.send({
          to: { id: melder.id, name: melder.name },
          from: by,
          kind: 'info',
          title: `${fault.number} is ${status}`,
          body: resolution || 'Bekijk de melding voor de toelichting.',
          link: 'storingen',
        })
      }
    }
    return bijgewerkt
  },

  async assign(id: string, to: Pick<User, 'id' | 'name'> | null, by: Pick<User, 'id' | 'name'>) {
    const fault = await db.faults.get(id)
    if (!fault) return
    const bijgewerkt = await faults.update(id, {
      assignedTo: to?.id,
      assignedName: to?.name,
      status: to && fault.status === 'gemeld' ? 'in behandeling' : fault.status,
    })
    if (to && to.id !== by.id) {
      await notifications.send({
        to, from: by, kind: 'taak',
        title: `Storing toegewezen: ${fault.number}`,
        body: fault.title,
        link: 'storingen',
      })
    }
    return bijgewerkt
  },
}

/* ----------------------------- Werkbonnen ------------------------- */

export const workOrders = {
  async create(input: {
    locationId: string
    type: WorkOrderType
    title: string
    description?: string
    priority?: WorkOrderPriority
    assetId?: string
    assetName?: string
    faultId?: string
    planId?: string
    plannedAt?: number
    checklist?: string[]
    by: Pick<User, 'id' | 'name'>
  }) {
    const aantal = await db.workOrders.count()
    const order: WorkOrder = {
      id: uid('wb'),
      number: nextNumber('W', aantal),
      locationId: input.locationId,
      assetId: input.assetId,
      assetName: input.assetName,
      faultId: input.faultId,
      planId: input.planId,
      type: input.type,
      priority: input.priority ?? 'normaal',
      status: input.plannedAt ? 'ingepland' : 'open',
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      createdBy: input.by.id,
      createdByName: input.by.name,
      createdAt: Date.now(),
      plannedAt: input.plannedAt,
      parts: [],
      checklist: (input.checklist ?? []).map((text) => ({ text, done: false })),
      updatedAt: Date.now(),
    }
    await put('workOrders', db.workOrders, order)

    // De storing weet nu welke werkbon eraan hangt.
    if (input.faultId) {
      await faults.update(input.faultId, { workOrderId: order.id, status: 'in behandeling' })
    }
    return order
  },

  async update(id: string, patch: Partial<WorkOrder>) {
    const order = await db.workOrders.get(id)
    if (!order) return
    return put('workOrders', db.workOrders, { ...order, ...patch, id })
  },

  async assign(id: string, to: Pick<User, 'id' | 'name'> | null, by: Pick<User, 'id' | 'name'>, plannedAt?: number) {
    const order = await db.workOrders.get(id)
    if (!order) return
    const bijgewerkt = await workOrders.update(id, {
      assignedTo: to?.id,
      assignedName: to?.name,
      plannedAt: plannedAt ?? order.plannedAt,
      status: to ? (order.status === 'open' ? 'ingepland' : order.status) : 'open',
    })
    if (to && to.id !== by.id) {
      await notifications.send({
        to, from: by, kind: 'taak',
        title: `Werkbon ${order.number} voor jou`,
        body: order.title + (plannedAt ? ` — ingepland op ${new Date(plannedAt).toLocaleDateString('nl-NL')}` : ''),
        link: 'werkbonnen',
      })
    }
    return bijgewerkt
  },

  async start(id: string) {
    return workOrders.update(id, { status: 'bezig', startedAt: Date.now() })
  },

  async toggleCheck(id: string, index: number, note?: string) {
    const order = await db.workOrders.get(id)
    if (!order) return
    const checklist = order.checklist.map((c, i) =>
      i === index ? { ...c, done: !c.done, note: note ?? c.note } : c)
    return workOrders.update(id, { checklist })
  },

  async addPart(id: string, part: WorkOrderPart) {
    const order = await db.workOrders.get(id)
    if (!order) return
    return workOrders.update(id, { parts: [...order.parts, part] })
  },

  async removePart(id: string, index: number) {
    const order = await db.workOrders.get(id)
    if (!order) return
    return workOrders.update(id, { parts: order.parts.filter((_, i) => i !== index) })
  },

  /** Afronden: uren en resultaat vastleggen, en alles wat eraan hangt bijwerken. */
  async complete(input: {
    id: string
    minutesSpent: number
    workDone: string
    signedOffBy?: string
    externalCost?: number
    by: Pick<User, 'id' | 'name'>
  }) {
    const order = await db.workOrders.get(input.id)
    if (!order) return

    const afgerond = await workOrders.update(input.id, {
      status: 'gereed',
      completedAt: Date.now(),
      minutesSpent: input.minutesSpent,
      workDone: input.workDone.trim(),
      signedOffBy: input.signedOffBy?.trim() || undefined,
      externalCost: input.externalCost,
    })

    // Storing eraan? Dan is die nu opgelost.
    if (order.faultId) {
      await faults.setStatus(order.faultId, 'opgelost', input.by, input.workDone)
    }

    // Onderhoudsbeurt? Dan schuift het schema door naar de volgende keer.
    if (order.planId) {
      const plan = await db.maintenancePlans.get(order.planId)
      if (plan) {
        const dagen = MAINTENANCE_DAYS[plan.interval]
        await maintenance.update(plan.id, {
          lastDoneAt: Date.now(),
          nextDueAt: Date.now() + dagen * DAY,
        })
      }
    }

    // Het apparaat is weer beschikbaar en de beurt is genoteerd.
    if (order.assetId) {
      await assets.update(order.assetId, {
        status: 'in bedrijf',
        lastServiceAt: order.type === 'preventief' ? Date.now() : undefined,
      })
    }

    return afgerond
  },
}

/* ------------------------------ Onderhoud ------------------------- */

export const maintenance = {
  async create(input: {
    title: string
    interval: MaintenanceInterval
    checklist: string[]
    estimatedMinutes: number
    assetId?: string
    locationId?: string
    category?: AssetCategory
    description?: string
    startAt?: number
  }) {
    const plan: MaintenancePlan = {
      id: uid('mp'),
      assetId: input.assetId,
      locationId: input.locationId,
      category: input.category,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      interval: input.interval,
      checklist: input.checklist.filter((c) => c.trim()),
      estimatedMinutes: input.estimatedMinutes,
      nextDueAt: input.startAt ?? Date.now() + MAINTENANCE_DAYS[input.interval] * DAY,
      active: true,
      updatedAt: Date.now(),
    }
    return put('maintenancePlans', db.maintenancePlans, plan)
  },

  async update(id: string, patch: Partial<MaintenancePlan>) {
    const plan = await db.maintenancePlans.get(id)
    if (!plan) return
    return put('maintenancePlans', db.maintenancePlans, { ...plan, ...patch, id })
  },

  /** Maakt van een openstaande beurt een werkbon. */
  async schedule(planId: string, by: Pick<User, 'id' | 'name'>, plannedAt?: number) {
    const plan = await db.maintenancePlans.get(planId)
    if (!plan) return

    const asset = plan.assetId ? await db.assets.get(plan.assetId) : undefined
    const locationId = asset?.locationId ?? plan.locationId
    if (!locationId) return

    return workOrders.create({
      locationId,
      type: 'preventief',
      title: plan.title,
      description: plan.description,
      assetId: plan.assetId,
      assetName: asset?.name,
      planId: plan.id,
      plannedAt: plannedAt ?? plan.nextDueAt,
      checklist: plan.checklist,
      by,
    })
  },
}

/* ------------------------------ Overzichten ----------------------- */

export type DueState = 'over tijd' | 'deze week' | 'gepland'

export function dueStateOf(plan: MaintenancePlan): DueState {
  const over = plan.nextDueAt < Date.now()
  if (over) return 'over tijd'
  return plan.nextDueAt < Date.now() + 7 * DAY ? 'deze week' : 'gepland'
}

/** Cijfers voor het management: stilstand, doorlooptijd, achterstand. */
export function techKpis(input: {
  faults: Fault[]
  orders: WorkOrder[]
  plans: MaintenancePlan[]
  days: number
}) {
  const from = Date.now() - input.days * DAY

  const recent = input.faults.filter((f) => f.reportedAt >= from)
  const opgelost = recent.filter((f) => f.status === 'opgelost' && f.resolvedAt)
  const open = input.faults.filter(
    (f) => f.status !== 'opgelost' && f.status !== 'afgewezen')

  const stilstand = opgelost.reduce((a, f) => a + (f.downtimeMinutes ?? 0), 0)
  const doorlooptijd = opgelost.length
    ? Math.round(opgelost.reduce((a, f) => a + ((f.resolvedAt! - f.reportedAt) / 60000), 0) / opgelost.length)
    : 0

  const klussen = input.orders.filter((o) => o.completedAt && o.completedAt >= from)
  const onderdelenKosten = klussen.reduce(
    (a, o) => a + o.parts.reduce((b, p) => b + p.qty * p.unitPrice, 0) + (o.externalCost ?? 0), 0)
  const monteursuren = klussen.reduce((a, o) => a + (o.minutesSpent ?? 0), 0) / 60

  const achterstallig = input.plans.filter((p) => p.active && p.nextDueAt < Date.now())
  const totaalActief = input.plans.filter((p) => p.active).length

  return {
    openStoringen: open.length,
    kritiek: open.filter((f) => f.severity === 'kritiek').length,
    gemeld: recent.length,
    opgelost: opgelost.length,
    stilstandMinuten: stilstand,
    gemDoorlooptijdMinuten: doorlooptijd,
    openWerkbonnen: input.orders.filter((o) => o.status !== 'gereed' && o.status !== 'geannuleerd').length,
    monteursuren: Math.round(monteursuren * 10) / 10,
    onderdelenKosten: Math.round(onderdelenKosten * 100) / 100,
    achterstallig: achterstallig.length,
    onderhoudOpPeil: totaalActief
      ? Math.round(((totaalActief - achterstallig.length) / totaalActief) * 100)
      : 100,
  }
}
