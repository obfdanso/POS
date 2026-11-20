// Imported first by app.ts. Imports run in order, so the environment is loaded and error
// reporting is started before any other module loads.
import 'dotenv/config'
import { initErrorReporting } from './utils/errorReporting'

// Optional error reporting (SENTRY_DSN); started first so it sees errors from everything else
initErrorReporting()
