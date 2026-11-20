import { Prisma } from '@prisma/client'
import prisma from '../utils/prismaClient'
import { recordAudit } from '../utils/audit'
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors'

const PUBLIC_FIELDS = { id: true, name: true, code: true } satisfies Prisma.BranchSelect

export interface BranchInput {
  name: string
  code: string
  address?: string | null
  phone?: string | null
}

export interface BranchChanges {
  name?: string
  code?: string
  address?: string | null
  phone?: string | null
  is_active?: boolean
}

/**
 * Branches, by name. `active: true` lists only open branches and only the fields every signed-in
 * user may see (id, name, code), for the branch switcher and product form.
 */
export function listBranches({ active = false }: { active?: boolean } = {}) {
  return prisma.branch.findMany({
    where: active ? { is_active: true } : {},
    ...(active && { select: PUBLIC_FIELDS }),
    orderBy: { name: 'asc' },
  })
}

export async function getBranch(id: string) {
  const branch = await prisma.branch.findUnique({ where: { id } })
  if (!branch) throw new NotFoundError('Branch not found')
  return branch
}

function conflict(err: unknown): unknown {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return err
  const field = String(err.meta?.target ?? '').includes('code') ? 'code' : 'name'
  return new ConflictError(`A branch with that ${field} already exists`)
}

export async function createBranch({ name, code, address, phone }: BranchInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data: { name, code, address: address || null, phone: phone || null } })
      await recordAudit({ userId, action: 'BRANCH_CREATED', entity: 'Branch', entityId: branch.id, details: `${code} ${name}` }, tx)
      return branch
    })
  } catch (err) {
    throw conflict(err)
  }
}

export async function updateBranch(id: string, data: BranchChanges, userId: string) {
  const existing = await getBranch(id)
  const changes: Prisma.BranchUpdateInput = {}
  for (const key of ['name', 'code', 'address', 'phone', 'is_active'] as const) {
    const value = data[key]
    // An empty string clears an optional field
    if (value !== undefined) Object.assign(changes, { [key]: value === '' ? null : value })
  }
  try {
    return await prisma.$transaction(async (tx) => {
      // An open drawer has to be counted and closed before its branch closes. The row lock makes a
      // shift opening at the same moment wait (openShift takes the same lock).
      if (data.is_active === false && existing.is_active) {
        await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${id} FOR UPDATE`
        const open = await tx.shift.count({ where: { branch_id: id, status: 'OPEN' } })
        if (open > 0) {
          const message = `Close the ${open} open shift${open === 1 ? '' : 's'} at this branch first`
          throw new ValidationError(message, [{ field: 'is_active', message }])
        }
      }
      const branch = await tx.branch.update({ where: { id }, data: changes })
      await recordAudit(
        { userId, action: 'BRANCH_UPDATED', entity: 'Branch', entityId: id, details: JSON.stringify(changes) },
        tx
      )
      return branch
    })
  } catch (err) {
    throw conflict(err)
  }
}
