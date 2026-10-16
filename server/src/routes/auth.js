const express = require('express')
const { body } = require('express-validator')
const rateLimit = require('express-rate-limit')
const authController = require('../controllers/authController')
const { authenticate } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')

const router = express.Router()

// Brute-force protection for login: 10 attempts per minute per IP
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Integration tests log in many times per minute
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Too many requests. Please try again in a minute.',
    },
  },
})

// Refresh runs on every page load and token renewal, and every till in a shop shares one IP,
// so it gets a looser limit; it needs a valid httpOnly refresh token, so it can't guess passwords
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Too many requests. Please try again in a minute.',
    },
  },
})

const loginValidation = [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
]

const changePasswordValidation = [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
]

const profileValidation = [
  body('full_name').optional().trim().notEmpty().withMessage('Full name cannot be empty').isLength({ max: 100 }).withMessage('Full name must be under 100 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
]

router.post('/login', authLimiter, exactBody(loginValidation), validate, authController.login)
router.post('/logout', authenticate, authController.logout)
router.post('/refresh', refreshLimiter, authController.refresh)
router.get('/me', authenticate, authController.getMe)
router.post('/change-password', authenticate, exactBody(changePasswordValidation), validate, authController.changePassword)
router.put('/profile', authenticate, exactBody(profileValidation), validate, authController.updateProfile)

module.exports = router
