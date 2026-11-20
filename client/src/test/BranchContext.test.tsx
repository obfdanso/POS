import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

const BRANCHES = [
  { id: 'b1', name: 'Kumasi Central', code: 'KSI' },
  { id: 'b2', name: 'Accra Mall', code: 'ACC' },
]

vi.mock('../services/api', () => ({
  default: { get: vi.fn(async () => ({ data: { data: BRANCHES } })) },
  setBranchId: vi.fn(),
}))

import { setBranchId as sendBranchHeader } from '../services/api'
import { AuthContext } from '../context/AuthContext'
import { BranchProvider } from '../context/BranchContext'
import { useBranch } from '../hooks/useBranch'
import type { User } from '../types'

function Probe() {
  const branch = useBranch()
  return (
    <div>
      <button onClick={() => branch.setBranchId(null)}>All branches</button>
      <span data-testid="branch">{branch.branchId ?? 'all'}</span>
      <span data-testid="name">{branch.currentBranch?.name ?? 'All branches'}</span>
      <span data-testid="switch">{String(branch.canSwitch)}</span>
    </div>
  )
}

function renderAs(fields: Pick<User, 'id' | 'role' | 'branch'>) {
  const user: User = { username: fields.id, email: `${fields.id}@example.com`, full_name: fields.id, is_active: true, created_at: '', updated_at: '', ...fields }
  const auth = { user, isAuthenticated: true, isLoading: false, login: vi.fn(), logout: vi.fn(), refreshUser: vi.fn() }
  return render(
    <AuthContext.Provider value={auth}>
      <BranchProvider>
        <Probe />
      </BranchProvider>
    </AuthContext.Provider>
  )
}

const lastHeader = () => vi.mocked(sendBranchHeader).mock.calls.at(-1)?.[0]

describe('BranchContext', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(sendBranchHeader).mockClear()
  })

  it("remembers an admin's branch and sends it with every request", async () => {
    localStorage.setItem('quickmart.branchId', 'b2')
    renderAs({ id: 'u1', role: 'ADMIN', branch: null })
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Accra Mall'))
    expect(screen.getByTestId('branch')).toHaveTextContent('b2')
    expect(lastHeader()).toBe('b2')
    expect(screen.getByTestId('switch')).toHaveTextContent('true')

    act(() => screen.getByRole('button', { name: 'All branches' }).click())
    expect(screen.getByTestId('branch')).toHaveTextContent('all')
    expect(lastHeader()).toBeNull()
    expect(localStorage.getItem('quickmart.branchId')).toBeNull()
  })

  it('falls back to all branches when the remembered branch no longer exists', async () => {
    localStorage.setItem('quickmart.branchId', 'gone')
    renderAs({ id: 'u1', role: 'ADMIN', branch: null })
    await waitFor(() => expect(screen.getByTestId('branch')).toHaveTextContent('all'))
    expect(lastHeader()).toBeNull()
  })

  it('keeps cashiers and managers on their own branch', async () => {
    localStorage.setItem('quickmart.branchId', 'b2')
    renderAs({ id: 'u2', role: 'CASHIER', branch: { id: 'b1', name: 'Kumasi Central', code: 'KSI' } })
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Kumasi Central'))
    expect(screen.getByTestId('branch')).toHaveTextContent('b1')
    expect(screen.getByTestId('switch')).toHaveTextContent('false')
    expect(lastHeader()).toBeNull()
  })
})
