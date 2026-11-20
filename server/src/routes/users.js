const express = require('express')
const { body, param } = require('express-validator')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')
const prisma = require('../utils/prismaClient')
const bcrypt = require('bcrypt')
const { recordAudit } = require('../utils/audit')
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors')

const router = express.Router()

router.use(authenticate)

const USER_FIELDS = {
  id: true,
  username: true,
  email: true,
  full_name: true,
  role: true,
  is_active: true,
  created_at: true,
  branch: { select: { id: true, name: true, code: true } },
}
const branchIdRule = body('branch_id').optional({ nullable: true }).isUUID().withMessage('Choose a valid branch')
const branchError = (message) => new ValidationError(message, [{ field: 'branch_id', message }])

/**
 * The branch a user with this role should have: none for admins; an open branch for cashiers and
 * managers (their current one when the request doesn't name another).
 */
async function branchForRole(role, requestedId, currentId = null) {
  if (role === 'ADMIN') return null
  const id = requestedId ?? currentId
  if (!id) throw branchError('Cashiers and managers need a branch')
  const branch = await prisma.branch.findFirst({ where: { id, is_active: true }, select: { id: true } })
  if (!branch) throw branchError('That branch does not exist or is closed')
  return branch.id
}

// Minimal staff directory (names only) so managers can filter sales by cashier
router.get('/staff', authorize(['ADMIN', 'MANAGER']), async (req, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      select: { id: true, full_name: true, role: true },
      orderBy: { full_name: 'asc' },
    })
    res.json({ success: true, data: staff })
  } catch (err) {
    next(err)
  }
})

// Everything below is user management, which is ADMIN-only
router.use(authorize(['ADMIN']))

// List all users
router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { ...USER_FIELDS, locked_until: true },
      orderBy: { created_at: 'asc' },
    })
    const now = new Date()
    const data = users.map((u) => ({
      ...u,
      is_locked: u.locked_until ? new Date(u.locked_until) > now : false,
    }))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

// Create user
router.post(
  '/',
  exactBody([
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('role').isIn(['ADMIN', 'MANAGER', 'CASHIER']).withMessage('Valid role required'),
    branchIdRule,
  ]),
  validate,
  async (req, res, next) => {
    try {
      const { username, email, password, full_name, role } = req.body
      const existing = await prisma.user.findFirst({
        where: { OR: [{ username: { equals: username, mode: 'insensitive' } }, { email }] },
      })
      if (existing) {
        throw existing.email === email
          ? new ConflictError('Email already in use', 'email')
          : new ConflictError('Username already taken', 'username')
      }
      const branch_id = await branchForRole(role, req.body.branch_id)
      const password_hash = await bcrypt.hash(password, 12)
      const user = await prisma.user.create({
        data: { username, email, password_hash, full_name, role, branch_id },
        select: USER_FIELDS,
      })
      await recordAudit({ userId: req.user.id, action: 'USER_CREATED', entity: 'User', entityId: user.id, details: `${user.username} (${user.role})` })
      res.status(201).json({ success: true, data: user, message: 'User created successfully' })
    } catch (err) {
      next(err)
    }
  }
)

// Update user (role, active status, full_name, email)
router.put(
  '/:id',
  [
    param('id').isUUID(),
    ...exactBody([
      body('role').optional().isIn(['ADMIN', 'MANAGER', 'CASHIER']).withMessage('Valid role required'),
      body('is_active').optional().isBoolean({ strict: true }).withMessage('is_active must be true or false').toBoolean(),
      body('full_name').optional().trim().notEmpty().withMessage('Full name cannot be empty'),
      body('email').optional().isEmail().withMessage('Valid email required'),
      branchIdRule,
    ]),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { role, is_active, full_name, email } = req.body
      const user = await prisma.user.findUnique({ where: { id: req.params.id } })
      if (!user) throw new NotFoundError('User not found')

      // Admins can't lock themselves out of user management
      if (user.id === req.user.id && ((role !== undefined && role !== 'ADMIN') || is_active === false)) {
        throw new ValidationError('You cannot remove your own admin access', [
          { field: role !== undefined && role !== 'ADMIN' ? 'role' : 'is_active', message: 'Ask another admin to change your own role or status' },
        ])
      }
      const branch_id = await branchForRole(role ?? user.role, req.body.branch_id, user.branch_id)
      // Their open drawer belongs to the old branch, so it has to be closed before they move
      if (branch_id !== user.branch_id && (await prisma.shift.count({ where: { user_id: user.id, status: 'OPEN' } }))) {
        throw branchError('Close their open shift before moving them to another branch')
      }
      const updated = await prisma.user.update({
        where: { id: req.params.id },
        data: {
          ...(role !== undefined && { role }),
          ...(is_active !== undefined && { is_active }),
          ...(full_name && { full_name }),
          ...(email && { email }),
          branch_id,
        },
        select: USER_FIELDS,
      })
      const changes = Object.entries({ role, is_active, full_name, email, branch_id })
        .filter(([key, value]) => value !== undefined && value !== user[key])
        .map(([key, value]) => `${key}: ${user[key]} → ${value}`)
      if (changes.length) {
        await recordAudit({ userId: req.user.id, action: 'USER_UPDATED', entity: 'User', entityId: user.id, details: `${user.username}: ${changes.join(', ')}` })
      }
      res.json({ success: true, data: updated, message: 'User updated successfully' })
    } catch (err) {
      next(err)
    }
  }
)

// Reset password
router.post(
  '/:id/reset-password',
  [param('id').isUUID(), ...exactBody([body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')])],
  validate,
  async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } })
      if (!user) throw new NotFoundError('User not found')
      const password_hash = await bcrypt.hash(req.body.password, 12)
      // Also unlock the account, and sign out every existing session of that user
      await prisma.user.update({
        where: { id: req.params.id },
        data: { password_hash, failed_login_attempts: 0, locked_until: null, tokens_valid_after: new Date() },
      })
      await recordAudit({ userId: req.user.id, action: 'PASSWORD_RESET', entity: 'User', entityId: user.id, details: user.username })
      res.json({ success: true, message: 'Password reset successfully' })
    } catch (err) {
      next(err)
    }
  }
)

// Unlock account
router.post('/:id/unlock', [param('id').isUUID()], validate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!user) throw new NotFoundError('User not found')
    await prisma.user.update({
      where: { id: req.params.id },
      data: { failed_login_attempts: 0, locked_until: null },
    })
    await prisma.authLog.create({
      data: {
        user_id: user.id,
        event_type: 'ACCOUNT_UNLOCKED',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] || null,
        details: `Unlocked by admin ${req.user.username}`,
      },
    })
    res.json({ success: true, message: 'Account unlocked successfully' })
  } catch (err) {
    next(err)
  }
})

module.exports = router
