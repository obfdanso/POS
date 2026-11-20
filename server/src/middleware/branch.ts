const prisma = require('../utils/prismaClient').default
const { ValidationError } = require('../utils/errors')

const branchError = (message) => new ValidationError(message, [{ field: 'branch', message }])

/**
 * Work out which branch a request acts on and put it on `req.branchId` (null = all branches).
 * Cashiers and managers always act on their own branch, whatever the client sends. Admins pick one
 * with the `X-Branch-Id` header (a closed branch only for reading); without it they see all branches.
 * Runs inside `authenticate`, after `req.user` is set.
 */
async function resolveBranch(req) {
  if (req.user.role !== 'ADMIN') {
    req.branchId = req.user.branch_id
    return
  }
  const requested = req.headers['x-branch-id']
  if (!requested) {
    req.branchId = null
    return
  }
  const branch = await prisma.branch.findUnique({
    where: { id: String(requested) },
    select: { id: true, is_active: true },
  })
  if (!branch) throw branchError('That branch does not exist')
  // A closed branch's history stays readable, but nothing new can happen there
  if (!branch.is_active && !['GET', 'HEAD'].includes(req.method)) throw branchError('That branch is closed')
  req.branchId = branch.id
}

/** For actions that change stock or money: an admin viewing all branches must pick one first. */
function requireBranch(req, res, next) {
  if (!req.branchId) return next(branchError('Choose a branch first'))
  next()
}

module.exports = { resolveBranch, requireBranch }
