import { useOnlineStatus } from '../hooks/useOnlineStatus'

// Warns that nothing can be saved while the connection is down; the screens still load from cache
export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div role="status" className="fixed bottom-0 inset-x-0 z-50 bg-warning-100 text-warning-800 border-t border-warning-300 text-sm font-medium text-center px-4 py-2">
      You're offline. Sales and changes can't be saved until the connection is back.
    </div>
  )
}
