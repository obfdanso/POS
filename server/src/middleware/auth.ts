const jwt = require('jsonwebtoken')
const prisma = require('../utils/prismaClient').default
const { UnauthorizedError, ForbiddenError } = require('../utils/errors')

const NO_BRANCH = 'You are not assigned to a branch. Ask an admin.'
const { issuedBeforeCutoff } = require('../services/authService')
const { resolveBranch } = require('./branch')

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided')
    }

    const token = authHeader.split(' ')[1]
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET)

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        email: true,
        full_name: true,
        role: true,
        is_active: true,
        tokens_valid_after: true,
        branch_id: true,
        branch: { select: { is_active: true } },
      },
    })

    if (!user || !user.is_active) {
      throw new UnauthorizedError('User not found or inactive')
    }
    if (issuedBeforeCutoff(payload, user)) {
      throw new UnauthorizedError('Session ended. Please sign in again.')
    }
    // Staff of a closed branch are signed out
    if (user.role !== 'ADMIN' && user.branch && !user.branch.is_active) {
      throw new UnauthorizedError('Your branch is closed')
    }
    // Without a branch a cashier or manager would otherwise see every branch
    if (user.role !== 'ADMIN' && !user.branch_id) throw new ForbiddenError(NO_BRANCH)
    delete user.tokens_valid_after
    delete user.branch

    req.user = user
    await resolveBranch(req)
    next()
  } catch (err) {
    next(err)
  }
}

function authorize(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles]
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Not authenticated'))
    }
    if (!allowed.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient permissions'))
    }
    next()
  }
}

module.exports = { authenticate, authorize }
