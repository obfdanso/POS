const crypto = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const prisma = require('../utils/prismaClient')
const { UnauthorizedError, NotFoundError } = require('../utils/errors')

const MAX_FAILED_ATTEMPTS = 5
// Locked accounts stay locked until an admin unlocks them (POST /api/users/:id/unlock).
// If every admin is locked out, run `npm run unlock-user -- <username>` on the server.
const LOCKED_UNTIL_ADMIN_UNLOCK = new Date('9999-12-31T00:00:00Z')

// In-memory blacklist for revoked refresh tokens.
// Tokens are auto-removed after their 7-day expiry so memory stays bounded.
const revokedTokens = new Set()

function revokeToken(token) {
  if (!token) return
  revokedTokens.add(token)
  // Clean up after the refresh token's maximum lifetime (7 days)
  setTimeout(() => revokedTokens.delete(token), 7 * 24 * 60 * 60 * 1000)
}

async function logAuthEvent(userId, eventType, ipAddress, userAgent, details) {
  await prisma.authLog.create({
    data: {
      user_id: userId || null,
      event_type: eventType,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      details: details || null,
    },
  })
}

function generateAccessToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  })
}

function generateRefreshToken(userId) {
  // A unique jwtid keeps rotated tokens distinct even when issued within the same second;
  // otherwise the "new" token equals the one just revoked and the session is lost
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    jwtid: crypto.randomUUID(),
  })
}

async function login(username, password, ipAddress, userAgent) {
  const user = await prisma.user.findFirst({
    where: {
      username: { equals: username, mode: 'insensitive' },
    },
  })

  if (!user) {
    await logAuthEvent(null, 'LOGIN_FAILED', ipAddress, userAgent, `Unknown username: ${username}`)
    throw new UnauthorizedError('Invalid credentials')
  }

  // Check account lock
  if (user.locked_until && user.locked_until > new Date()) {
    await logAuthEvent(user.id, 'LOGIN_BLOCKED', ipAddress, userAgent, 'Account locked')
    throw new UnauthorizedError('Account locked. Please contact an administrator.')
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash)

  if (!passwordValid) {
    const newFailCount = user.failed_login_attempts + 1
    const updateData = { failed_login_attempts: newFailCount }

    if (newFailCount >= MAX_FAILED_ATTEMPTS) {
      updateData.locked_until = LOCKED_UNTIL_ADMIN_UNLOCK
      await prisma.user.update({ where: { id: user.id }, data: updateData })
      await logAuthEvent(user.id, 'ACCOUNT_LOCKED', ipAddress, userAgent, `Locked after ${newFailCount} failed attempts`)
    } else {
      await prisma.user.update({ where: { id: user.id }, data: updateData })
      await logAuthEvent(user.id, 'LOGIN_FAILED', ipAddress, userAgent, `Failed attempt ${newFailCount}`)
    }

    throw new UnauthorizedError('Invalid credentials')
  }

  if (!user.is_active) {
    throw new UnauthorizedError('Account is deactivated')
  }

  // Reset failed attempts on success
  await prisma.user.update({
    where: { id: user.id },
    data: { failed_login_attempts: 0, locked_until: null },
  })

  const accessToken = generateAccessToken(user.id, user.role)
  const refreshToken = generateRefreshToken(user.id)

  await logAuthEvent(user.id, 'LOGIN_SUCCESS', ipAddress, userAgent, null)

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
  }
}

async function logout(userId, ipAddress, userAgent, refreshToken) {
  revokeToken(refreshToken)
  if (userId) {
    await logAuthEvent(userId, 'LOGOUT', ipAddress, userAgent, null)
  }
  return true
}

async function refreshToken(tokenFromCookie) {
  if (!tokenFromCookie) {
    throw new UnauthorizedError('No refresh token')
  }

  if (revokedTokens.has(tokenFromCookie)) {
    throw new UnauthorizedError('Refresh token has been revoked')
  }

  let payload
  try {
    payload = jwt.verify(tokenFromCookie, process.env.JWT_REFRESH_SECRET)
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token')
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, is_active: true },
  })

  if (!user || !user.is_active) {
    throw new UnauthorizedError('User not found or inactive')
  }

  // Rotate: revoke the old token and issue a fresh one
  revokeToken(tokenFromCookie)
  const accessToken = generateAccessToken(user.id, user.role)
  const newRefreshToken = generateRefreshToken(user.id)

  await logAuthEvent(user.id, 'TOKEN_REFRESH', null, null, null)

  return { accessToken, refreshToken: newRefreshToken }
}

async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      full_name: true,
      role: true,
      is_active: true,
      created_at: true,
    },
  })

  if (!user) {
    throw new NotFoundError('User not found')
  }

  return user
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new NotFoundError('User not found')

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) throw new UnauthorizedError('Current password is incorrect')

  const password_hash = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({ where: { id: userId }, data: { password_hash } })
  return true
}

async function updateProfile(userId, { full_name, email }) {
  const data = {}
  if (full_name !== undefined) data.full_name = full_name
  if (email !== undefined) data.email = email

  if (Object.keys(data).length === 0) {
    return getMe(userId)
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      full_name: true,
      role: true,
      is_active: true,
      created_at: true,
    },
  })
  return user
}

module.exports = { login, logout, refreshToken, getMe, changePassword, updateProfile }
