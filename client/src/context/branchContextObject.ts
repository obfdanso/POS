import { createContext } from 'react'
import type { BranchRef } from '../types'

export interface BranchContextValue {
  /** Open branches, as `GET /branches?active=true` lists them */
  branches: BranchRef[]
  /** The branch the app is working in; null means all branches (admins only) */
  branchId: string | null
  currentBranch: BranchRef | null
  isAllBranches: boolean
  canSwitch: boolean
  setBranchId: (id: string | null | undefined) => void
  reloadBranches: () => Promise<void>
  branchesLoaded: boolean
  branchesFailed: boolean
}

// Kept apart from BranchProvider so that file only exports a component (fast refresh)
export const BranchContext = createContext<BranchContextValue | null>(null)
