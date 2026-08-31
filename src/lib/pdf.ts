/* ------------------------------------------------------------------ *
 *  pdf.js, één keer opgehaald
 *
 *  Twee plekken hebben hem nodig: het uitlezen van een contract en het
 *  bekijken van een bijlage. Hij is groot, dus hij komt pas binnen als er
 *  daadwerkelijk een PDF opengaat -- niet bij het opstarten van de app.
 * ------------------------------------------------------------------ */

let pdfjs: typeof import('pdfjs-dist') | null = null

export async function laadPdfjs() {
  if (pdfjs) return pdfjs
  const mod = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  mod.GlobalWorkerOptions.workerSrc = worker.default
  pdfjs = mod
  return mod
}
