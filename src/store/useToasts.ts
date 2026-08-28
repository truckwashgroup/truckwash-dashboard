import { create } from 'zustand'

export type ToastTone = 'ok' | 'warn' | 'error' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  text: string
}

interface ToastStore {
  items: Toast[]
  push: (text: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastStore>((set, get) => ({
  items: [],
  push: (text, tone = 'info') => {
    const id = ++seq
    set({ items: [...get().items, { id, tone, text }] })
    setTimeout(() => get().dismiss(id), 4200)
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}))

export const toast = {
  ok: (t: string) => useToasts.getState().push(t, 'ok'),
  warn: (t: string) => useToasts.getState().push(t, 'warn'),
  error: (t: string) => useToasts.getState().push(t, 'error'),
  info: (t: string) => useToasts.getState().push(t, 'info'),
}
