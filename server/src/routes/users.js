const express = require('express')
const { body, param } = require('express-validator')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')
const prisma = require('../utils/prismaClient')
const bcrypt = require('bcrypt')
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors')

const router = express.Router()

router.use(authenticate)

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
      select: { id: true, username: true, email: true, full_name: true, role: true, is_active: true, locked_until: true, created_at: true },
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
    body('username').notEmpty().trim().withMessage('Username is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('full_name').notEmpty().trim().withMessage('Full name is required'),
    body('role').isIn(['ADMIN', 'MANAGER', 'CASHIER']).withMessage('Valid role required'),
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
      const password_hash = await bcrypt.hash(password, 12)
      const user = await prisma.user.create({
        data: { username, email, password_hash, full_name, role },
        select: { id: true, username: true, email: true, full_name: true, role: true, is_active: true, created_at: true },
      })
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
      body('is_active').optional().isBoolean().withMessage('is_active must be true or false'),
      body('full_name').optional().trim().notEmpty().withMessage('Full name cannot be empty'),
      body('email').optional().isEmail().withMessage('Valid email required'),
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
      const updated = await prisma.user.update({
        where: { id: req.params.id },
        data: { ...(role !== undefined && { role }), ...(is_active !== undefined && { is_active }), ...(full_name && { full_name }), ...(email && { email }) },
        select: { id: true, username: true, email: true, full_name: true, role: true, is_active: true, created_at: true },
      })
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
      // Also unlock account
      await prisma.user.update({ where: { id: req.params.id }, data: { password_hash, failed_login_attempts: 0, locked_until: null } })
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
