import { createContext, useReducer, useEffect, type ReactNode } from 'react'
import { setReportingUser } from '../utils/errorReporting'
import api, { setAccessToken, clearAccessToken, refreshAccessToken } from '../services/api'
import type { ApiSuccess, User } from '../types'

/** The user as `POST /auth/login` returns it (the full profile comes from `GET /auth/me`) */
export type LoginUser = Pick<User, 'id' | 'username' | 'email' | 'full_name' | 'role'>

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

export interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<LoginUser>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

type AuthAction =
  | { type: 'LOGIN_SUCCESS'; payload: { user: User } }
  | { type: 'LOGOUT' }
  | { type: 'AUTH_CHECKED' }
  | { type: 'SET_USER'; payload: User }

export const AuthContext = createContext<AuthContextValue | null>(null)

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
}

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
      return {
        user: action.payload.user,
        isAuthenticated: true,
        isLoading: false,
      }
    case 'LOGOUT':
      return {
        user: null,
        isAuthenticated: false,
        isLoading: false,
      }
    case 'AUTH_CHECKED':
      return {
        ...state,
        isLoading: false,
      }
    case 'SET_USER':
      return {
        ...state,
        user: { ...state.user, ...action.payload },
      }
    default:
      return state
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState)

  // Error reports carry only the signed-in user's ID and role
  const userId = state.user?.id
  const userRole = state.user?.role
  useEffect(() => {
    setReportingUser(userId ? { id: userId, role: userRole } : null)
  }, [userId, userRole])

  // On app load: try silent refresh using the httpOnly cookie
  useEffect(() => {
    async function checkAuth() {
      try {
        await refreshAccessToken()
        const meRes = await api.get<ApiSuccess<User>>('/auth/me')
        dispatch({ type: 'LOGIN_SUCCESS', payload: { user: meRes.data.data } })
      } catch {
        // No valid session — user must log in
        dispatch({ type: 'AUTH_CHECKED' })
      }
    }
    checkAuth()
  }, [])

  async function login(username: string, password: string): Promise<LoginUser> {
    const { data } = await api.post<ApiSuccess<{ accessToken: string; user: LoginUser }>>('/auth/login', { username, password })
    const { accessToken, user } = data.data
    setAccessToken(accessToken)
    // Fetch full profile so created_at and all fields are available
    const meRes = await api.get<ApiSuccess<User>>('/auth/me')
    const fullUser = meRes.data.data
    dispatch({ type: 'LOGIN_SUCCESS', payload: { user: fullUser } })
    return user
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      clearAccessToken()
      // Per-session data must not carry over to the next person on this till
      try {
        sessionStorage.removeItem('pos_session_sales')
      } catch {
        // sessionStorage unavailable
      }
      dispatch({ type: 'LOGOUT' })
    }
  }

  async function refreshUser(): Promise<void> {
    const meRes = await api.get<ApiSuccess<User>>('/auth/me')
    dispatch({ type: 'SET_USER', payload: meRes.data.data })
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}
