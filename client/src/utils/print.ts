import toast from 'react-hot-toast'

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

// Escape text before writing it into a print window's HTML
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ENTITIES[c])
}

// Shared 80mm thermal receipt styling for printed documents
export const RECEIPT_STYLES = `
    @page { size: 80mm auto; margin: 0; }
    body { font-family: monospace; font-size: 12px; width: 72mm; margin: 0 auto; padding: 4mm; color: #000; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .dashed { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }`

/** Opens `html` (already escaped) in a small window and prints it. */
export function printDocument(html: string): void {
  const win = window.open('', '_blank', 'width=420,height=640')
  if (!win) {
    toast.error('Allow pop-ups for this site to print receipts')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  win.addEventListener('afterprint', () => win.close())
  win.print()
}
