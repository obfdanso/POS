import { createContext } from 'react'

// Kept apart from BranchProvider so that file only exports a component (fast refresh)
export const BranchContext = createContext(null)
