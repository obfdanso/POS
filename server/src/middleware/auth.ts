import jwt from 'jsonwebtoken'
import type { Role } from '@prisma/client'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import prisma from '../utils/prismaClient'
import { UnauthorizedError, ForbiddenError } from '../utils/errors'
import { issuedBeforeCutoff } from '../services/authService'
import { resolveBranch } from './branch'
import type { AuthUser } from '../types/express'

const NO_BRANCH = 'You are not assigned to a branch. Ask an admin.'

/** What this server puts in an access token (see authService.generateAccessToken). */
interface AccessTokenPayload {
  userId: string
  role: Role
  iat: number
  iat_ms?: number
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided')
    }

    const token = authHeader.split(' ')[1]
    // The signature is verified, so the payload is one this server signed
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET ?? '') as AccessTokenPayload

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
    const { tokens_valid_after: _tokensValidAfter, branch: _branch, ...profile } = user

    req.user = profile
    await resolveBranch(req)
    next()
  } catch (err) {
    next(err)
  }
}

export function authorize(roles: Role | Role[]): RequestHandler {
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

/**
 * The signed-in user, for handlers behind `authenticate` (which always sets it). Throws the same
 * error `authorize` would if a route ever forgets that middleware.
 */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new UnauthorizedError('Not authenticated')
  return req.user
}
