// Imported first by test files that talk to the database: loads server/.env before the app does
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(__dirname, '../../.env') })
