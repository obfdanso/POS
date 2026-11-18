require('dotenv').config()
// Optional error reporting (SENTRY_DSN); started first so it sees errors from everything below
require('./utils/errorReporting').initErrorReporting()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const cookieParser = require('cookie-parser')
const morgan = require('morgan')
const path = require('path')

const { logger, morganStream } = require('./middleware/logger')
const errorHandler = require('./middleware/errorHandler')
const requestId = require('./middleware/requestId')
const prisma = require('./utils/prismaClient')
const authRoutes = require('./routes/auth')
const productRoutes = require('./routes/products')
const categoryRoutes = require('./routes/categories')
const inventoryRoutes = require('./routes/inventory')
const salesRoutes = require('./routes/sales')
const customerRoutes = require('./routes/customers')
const reportRoutes = require('./routes/reports')
const userRoutes = require('./routes/users')
const settingsRoutes = require('./routes/settings')
const supplierRoutes = require('./routes/suppliers')
const shiftRoutes = require('./routes/shifts')
const purchaseOrderRoutes = require('./routes/purchaseOrders')
const promotionRoutes = require('./routes/promotions')

const app = express()

// Behind a reverse proxy (nginx, Caddy, …) set TRUST_PROXY=1 so req.ip is the client's
// address, not the proxy's; rate limits and the auth log depend on it
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY)
}

// Tag every request with an ID first, so every log line and error can be traced back to it
app.use(requestId)

// Security headers
app.use(helmet())

// CORS — allow frontend origin with credentials (for cookies)
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  })
)

// Request parsing
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// HTTP request logging: request ID, client, method, path, status, size and response time
morgan.token('id', (req) => req.id)
app.use(
  morgan(':id :remote-addr ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms ":user-agent"', {
    stream: morganStream,
  })
)

// Static files for uploaded product images
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// Static files for seeded product images (named by SKU, e.g. /product-images/BEV-001.jpg)
app.use('/product-images', express.static(path.join(__dirname, '..', 'product-images')))

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
    message: 'Server is running',
  })
})

// Readiness: the API can only serve requests while it can reach the database. Load balancers,
// Docker and uptime monitors use this; it answers 503 (without error details) when it can't
app.get('/api/health/ready', async (req, res) => {
  const started = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    res.status(200).json({
      success: true,
      data: { status: 'ready', database: 'ok', database_ms: Date.now() - started, uptime_s: Math.round(process.uptime()) },
    })
  } catch (err) {
    logger.error(`[${req.id}] Readiness check failed: ${err.message}`)
    res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unreachable' },
    })
  }
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/products', productRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/sales', salesRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/users', userRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/suppliers', supplierRoutes)
app.use('/api/shifts', shiftRoutes)
app.use('/api/purchase-orders', purchaseOrderRoutes)
app.use('/api/promotions', promotionRoutes)

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  })
})

// Global error handler (must be last)
app.use(errorHandler)

// Start server only when run directly (not when imported in tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3001
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`)
  })
}

module.exports = app
