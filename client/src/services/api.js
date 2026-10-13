import axios from 'axios'

// In-memory access token store (not localStorage — security best practice)
let _accessToken = null

export function setAccessToken(token) {
  _accessToken = token
}

export function getAccessToken() {
  return _accessToken
}

export function clearAccessToken() {
  _accessToken = null
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send/receive cookies (refresh token)
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token to every outgoing request
api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // Let the browser set Content-Type (including multipart boundary) for FormData
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  return config
})

// One refresh request at a time: concurrent callers (several 401s, or React StrictMode
// running the startup auth check twice) share it. Refresh tokens rotate on every use,
// so a second parallel request would present an already-revoked token and log the user out.
let refreshPromise = null

export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/auth/refresh', {}, { withCredentials: true })
      .then(({ data }) => {
        const token = data.data.accessToken
        setAccessToken(token)
        return token
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

// Silent token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // A 401 from login means bad credentials, not an expired session — show it as-is
    const isLogin = originalRequest?.url === '/auth/login'

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isLogin) {
      originalRequest._retry = true
      try {
        const token = await refreshAccessToken()
        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      } catch (refreshError) {
        clearAccessToken()
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

export default api
