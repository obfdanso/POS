const authService = require('../services/authService')

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body
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

async function logout(req, res, next) {
  try {
    await authService.logout(req.user?.id, req.ip, req.headers['user-agent'], req.cookies?.refreshToken)

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
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

async function refresh(req, res, next) {
  try {
    const tokenFromCookie = req.cookies?.refreshToken
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

async function getMe(req, res, next) {
  try {
    const user = await authService.getMe(req.user.id)
    res.status(200).json({
      success: true,
      data: user,
    })
  } catch (err) {
    next(err)
  }
}

async function changePassword(req, res, next) {
  try {
    const { current_password, new_password } = req.body
    const tokens = await authService.changePassword(req.user.id, current_password, new_password, req.cookies?.refreshToken)
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

async function updateProfile(req, res, next) {
  try {
    const { full_name, email } = req.body
    const user = await authService.updateProfile(req.user.id, { full_name, email })
    res.status(200).json({
      success: true,
      data: user,
      message: 'Profile updated successfully',
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { login, logout, refresh, getMe, changePassword, updateProfile }
