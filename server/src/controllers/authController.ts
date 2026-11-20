import type { CookieOptions, NextFunction, Request, Response } from 'express'
import * as authService from '../services/authService'
import { currentUser } from '../middleware/auth'

// Secure (HTTPS-only) cookies in production. COOKIE_SECURE=false allows plain HTTP, e.g. tablets
// reaching a Docker install on the shop's local network; never use it on the internet.
const SECURE_COOKIES = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production'

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: SECURE_COOKIES,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
}

/** The refresh token cookie, when the request has one. */
function refreshCookie(req: Request): string | undefined {
  const token: unknown = req.cookies?.refreshToken
  return typeof token === 'string' ? token : undefined
}

/** Validated by the auth routes. */
interface LoginBody {
  username: string
  password: string
}

interface ChangePasswordBody {
  current_password: string
  new_password: string
}

interface ProfileBody {
  full_name?: string
  email?: string
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body as LoginBody
    const result = await authService.login(
      username,
      password,
      req.ip,
      req.headers['user-agent']
    )

    res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS)

    res.status(200).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
      message: 'Login successful',
    })
  } catch (err) {
    next(err)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.logout(req.user?.id, req.ip, req.headers['user-agent'], refreshCookie(req))

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: SECURE_COOKIES,
      sameSite: 'strict',
    })

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    })
  } catch (err) {
    next(err)
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const tokenFromCookie = refreshCookie(req)
    const result = await authService.refreshToken(tokenFromCookie)

    // Rotate cookie: replace old refresh token with newly issued one
    res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS)

    res.status(200).json({
      success: true,
      data: { accessToken: result.accessToken },
      message: 'Token refreshed',
    })
  } catch (err) {
    next(err)
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.getMe(currentUser(req).id)
    res.status(200).json({
      success: true,
      data: user,
    })
  } catch (err) {
    next(err)
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { current_password, new_password } = req.body as ChangePasswordBody
    const tokens = await authService.changePassword(currentUser(req).id, current_password, new_password, refreshCookie(req))
    // Other devices are signed out; this one continues with new tokens
    res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS)
    res.status(200).json({
      success: true,
      data: { accessToken: tokens.accessToken },
      message: 'Password changed successfully. Other devices have been signed out.',
    })
  } catch (err) {
    next(err)
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { full_name, email } = req.body as ProfileBody
    const user = await authService.updateProfile(currentUser(req).id, { full_name, email })
    res.status(200).json({
      success: true,
      data: user,
      message: 'Profile updated successfully',
    })
  } catch (err) {
    next(err)
  }
}
