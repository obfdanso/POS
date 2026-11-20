import { useContext } from 'react'
import { BranchContext, type BranchContextValue } from '../context/branchContextObject'

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch must be used within BranchProvider')
  return ctx
}
