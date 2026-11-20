const prisma = require('../utils/prismaClient')
const { recordAudit } = require('../utils/audit')
const { NotFoundError, ConflictError } = require('../utils/errors')

const PUBLIC_FIELDS = { id: true, name: true, code: true }

/**
 * Branches, by name. `active: true` lists only open branches and only the fields every signed-in
 * user may see (id, name, code), for the branch switcher and product form.
 */
function listBranches({ active = false } = {}) {
  return prisma.branch.findMany({
    where: active ? { is_active: true } : {},
    ...(active && { select: PUBLIC_FIELDS }),
    orderBy: { name: 'asc' },
  })
}

async function getBranch(id) {
  const branch = await prisma.branch.findUnique({ where: { id } })
  if (!branch) throw new NotFoundError('Branch not found')
  return branch
}

function conflict(err) {
  if (err.code !== 'P2002') return err
  const field = String(err.meta?.target ?? '').includes('code') ? 'code' : 'name'
  return new ConflictError(`A branch with that ${field} already exists`)
}

async function createBranch({ name, code, address, phone }, userId) {
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

async function updateBranch(id, data, userId) {
  await getBranch(id)
  const changes = {}
  for (const key of ['name', 'code', 'address', 'phone', 'is_active']) {
    if (data[key] !== undefined) changes[key] = data[key] === '' ? null : data[key]
  }
  try {
    return await prisma.$transaction(async (tx) => {
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

module.exports = { listBranches, getBranch, createBranch, updateBranch }
