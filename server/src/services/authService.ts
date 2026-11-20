import crypto from 'crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { Prisma, type Role, type User } from '@prisma/client'
import prisma from '../utils/prismaClient'
import { UnauthorizedError, NotFoundError, ValidationError } from '../utils/errors'

const MAX_FAILED_ATTEMPTS = 5
// Locked accounts stay locked until an admin unlocks them (POST /api/users/:id/unlock).
// If every admin is locked out, run `npm run unlock-user -- <username>` on the server.
const LOCKED_UNTIL_ADMIN_UNLOCK = new Date('9999-12-31T00:00:00Z')

/** What this server puts in a refresh token (see generateRefreshToken). */
interface RefreshTokenPayload {
  userId: string
  iat: number
  exp: number
  iat_ms?: number
  jti?: string
}

/** The issue-time claims `issuedBeforeCutoff` reads, from an access or refresh token. */
interface IssuedAt {
  iat: number
  iat_ms?: number
}

/** Payload of a valid refresh token, or null if it is missing, forged, or expired. */
function verifyRefreshToken(token: string | null | undefined): RefreshTokenPayload | null {
  if (!token) return null
  try {
    // The signature is verified, so the payload is one this server signed
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET ?? '') as RefreshTokenPayload
  } catch {
    return null
  }
}

/**
 * Record a verified refresh token as revoked, in the database so it stays revoked across
 * restarts and server instances. Returns false if it was already revoked: the insert doubles as
 * the check, so two requests racing to rotate the same token can't both succeed.
 */
async function revokeToken(payload: RefreshTokenPayload, token: string): Promise<boolean> {
  // Tokens issued before jwtids were added are keyed by a hash instead
  const jti = payload.jti || crypto.createHash('sha256').update(token).digest('hex')
  try {
    await prisma.revokedToken.create({ data: { jti, expires_at: new Date(payload.exp * 1000) } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
    throw err
  }
  // An entry past its token's expiry can never match a usable token, so drop it
  await prisma.revokedToken.deleteMany({ where: { expires_at: { lt: new Date() } } })
  return true
}

async function logAuthEvent(
  userId: string | null | undefined,
  eventType: string,
  ipAddress: string | null | undefined,
  userAgent: string | null | undefined,
  details: string | null
) {
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

/**
 * True when a token was issued before the user's session cut-off (set on password change/reset),
 * i.e. it belongs to a session that has been signed out everywhere.
 * Uses the millisecond `iat_ms` claim: JWT `iat` is whole seconds, and a one-second grace window
 * would let a session that refreshes in a loop keep a token from the cut-off second and survive.
 * Tokens without `iat_ms` (issued before this check existed) fall back to the start of their `iat` second.
 */
export function issuedBeforeCutoff(payload: IssuedAt, user: Pick<User, 'tokens_valid_after'>): boolean {
  if (!user.tokens_valid_after) return false
  const issuedAtMs = typeof payload.iat_ms === 'number' ? payload.iat_ms : payload.iat * 1000
  return issuedAtMs < user.tokens_valid_after.getTime()
}

// jsonwebtoken types `expiresIn` as a `ms` duration string; the env values are durations like '15m'
type ExpiresIn = NonNullable<jwt.SignOptions['expiresIn']>

function generateAccessToken(userId: string, role: Role): string {
  return jwt.sign({ userId, role, iat_ms: Date.now() }, process.env.JWT_ACCESS_SECRET ?? '', {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as ExpiresIn,
  })
}

function generateRefreshToken(userId: string): string {
  // A unique jwtid keeps rotated tokens distinct even when issued within the same second;
  // otherwise the "new" token equals the one just revoked and the session is lost
  return jwt.sign({ userId, iat_ms: Date.now() }, process.env.JWT_REFRESH_SECRET ?? '', {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as ExpiresIn,
    jwtid: crypto.randomUUID(),
  })
}

export async function login(
  username: string,
  password: string,
  ipAddress?: string | null,
  userAgent?: string | null
) {
  const user = await prisma.user.findFirst({
    where: {
      username: { equals: username, mode: 'insensitive' },
    },
    include: { branch: { select: { is_active: true } } },
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
    // Atomic increment: parallel wrong guesses each count, so the lock can't be outrun
    const { failed_login_attempts: failCount } = await prisma.user.update({
      where: { id: user.id },
      data: { failed_login_attempts: { increment: 1 } },
      select: { failed_login_attempts: true },
    })

    if (failCount >= MAX_FAILED_ATTEMPTS) {
      await prisma.user.update({ where: { id: user.id }, data: { locked_until: LOCKED_UNTIL_ADMIN_UNLOCK } })
      await logAuthEvent(user.id, 'ACCOUNT_LOCKED', ipAddress, userAgent, `Locked after ${failCount} failed attempts`)
    } else {
      await logAuthEvent(user.id, 'LOGIN_FAILED', ipAddress, userAgent, `Failed attempt ${failCount}`)
    }

    throw new UnauthorizedError('Invalid credentials')
  }

  if (!user.is_active) {
    await logAuthEvent(user.id, 'LOGIN_BLOCKED', ipAddress, userAgent, 'Account deactivated')
    throw new UnauthorizedError('Account is deactivated')
  }

  if (user.role !== 'ADMIN' && user.branch && !user.branch.is_active) {
    await logAuthEvent(user.id, 'LOGIN_BLOCKED', ipAddress, userAgent, 'Branch closed')
    throw new UnauthorizedError('Your branch is closed')
  }
  if (user.role !== 'ADMIN' && !user.branch_id) {
    await logAuthEvent(user.id, 'LOGIN_BLOCKED', ipAddress, userAgent, 'No branch assigned')
    throw new UnauthorizedError('You are not assigned to a branch. Ask an admin.')
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

export async function logout(
  userId: string | null | undefined,
  ipAddress: string | null | undefined,
  userAgent: string | null | undefined,
  refreshToken: string | null | undefined
) {
  const payload = verifyRefreshToken(refreshToken)
  if (payload && refreshToken) await revokeToken(payload, refreshToken)
  if (userId) {
    await logAuthEvent(userId, 'LOGOUT', ipAddress, userAgent, null)
  }
  return true
}

export async function refreshToken(tokenFromCookie: string | null | undefined) {
  if (!tokenFromCookie) {
    throw new UnauthorizedError('No refresh token')
  }

  const payload = verifyRefreshToken(tokenFromCookie)
  if (!payload) {
    throw new UnauthorizedError('Invalid or expired refresh token')
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, is_active: true, tokens_valid_after: true, branch: { select: { is_active: true } } },
  })

  if (!user || !user.is_active) {
    throw new UnauthorizedError('User not found or inactive')
  }
  if (user.role !== 'ADMIN' && user.branch && !user.branch.is_active) {
    throw new UnauthorizedError('Your branch is closed')
  }
  if (issuedBeforeCutoff(payload, user)) {
    throw new UnauthorizedError('Session ended. Please sign in again.')
  }

  // Rotate: revoke the old token and issue a fresh one
  if (!(await revokeToken(payload, tokenFromCookie))) {
    throw new UnauthorizedError('Refresh token has been revoked')
  }
  const accessToken = generateAccessToken(user.id, user.role)
  const newRefreshToken = generateRefreshToken(user.id)

  await logAuthEvent(user.id, 'TOKEN_REFRESH', null, null, null)

  return { accessToken, refreshToken: newRefreshToken }
}

export async function getMe(userId: string) {
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
      branch: { select: { id: true, name: true, code: true } },
    },
  })

  if (!user) {
    throw new NotFoundError('User not found')
  }

  return user
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentRefreshToken: string | null | undefined
) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new NotFoundError('User not found')

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  // 422, not 401: the session is fine, and a 401 would make the client refresh its token and retry
  if (!valid) {
    throw new ValidationError('Current password is incorrect', [
      { field: 'current_password', message: 'Current password is incorrect' },
    ])
  }

  const password_hash = await bcrypt.hash(newPassword, 12)
  // Sign out every existing session, then hand this device fresh tokens so it stays signed in
  await prisma.user.update({ where: { id: userId }, data: { password_hash, tokens_valid_after: new Date() } })
  const currentPayload = verifyRefreshToken(currentRefreshToken)
  if (currentPayload && currentRefreshToken) await revokeToken(currentPayload, currentRefreshToken)
  return {
    accessToken: generateAccessToken(user.id, user.role),
    refreshToken: generateRefreshToken(user.id),
  }
}

export async function updateProfile(userId: string, { full_name, email }: { full_name?: string; email?: string }) {
  const data: Prisma.UserUpdateInput = {}
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
