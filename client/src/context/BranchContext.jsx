import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api, { setBranchId as sendBranchHeader } from '../services/api'
import { AuthContext } from './AuthContext'
import { BranchContext } from './branchContextObject'

const STORAGE_KEY = 'quickmart.branchId'

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the choice just isn't remembered
  }
}

/**
 * Which branch the app is working in. Cashiers and managers always work at their own branch.
 * Admins choose one in the header (remembered on this device), or "All branches" (null), and the
 * choice is sent with every request as X-Branch-Id.
 */
export function BranchProvider({ children }) {
  const { user, isAuthenticated } = useContext(AuthContext)
  const isAdmin = user?.role === 'ADMIN'
  const [branches, setBranches] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [chosen, setChosen] = useState(() => readStored())

  const loadBranches = useCallback(async () => {
    try {
      const res = await api.get('/branches', { params: { active: 'true' } })
      setBranches(res.data.data || [])
    } catch {
      setBranches([])
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) loadBranches()
    else {
      setBranches([])
      setLoaded(false)
    }
  }, [isAuthenticated, loadBranches])

  // An admin's remembered branch only counts once the list confirms it is still an open branch
  const adminBranch = isAdmin && chosen && loaded && branches.some((b) => b.id === chosen) ? chosen : null
  const branchId = isAdmin ? adminBranch : (user?.branch?.id ?? null)

  // Set during render so requests made by children's effects already carry it
  sendBranchHeader(isAdmin ? adminBranch : null)

  useEffect(() => {
    if (isAdmin && loaded && chosen && !adminBranch) {
      writeStored(null)
      setChosen(null)
    }
  }, [isAdmin, loaded, chosen, adminBranch])

  const setBranchId = useCallback((id) => {
    const next = id || null
    writeStored(next)
    sendBranchHeader(next)
    setChosen(next)
  }, [])

  const currentBranch = useMemo(() => {
    if (!branchId) return null
    return branches.find((b) => b.id === branchId) ?? (user?.branch?.id === branchId ? user.branch : null)
  }, [branchId, branches, user])

  const value = useMemo(
    () => ({
      branches,
      branchId,
      currentBranch,
      isAllBranches: isAdmin && !branchId,
      canSwitch: isAdmin,
      setBranchId,
      reloadBranches: loadBranches,
    }),
    [branches, branchId, currentBranch, isAdmin, setBranchId, loadBranches]
  )

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}
