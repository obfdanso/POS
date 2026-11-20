import 'dotenv/config'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

/** The message of a thrown error, or the thrown value itself when it is not an Error. */
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const backupDir = path.join(__dirname, '..', 'backups')
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true })
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const filename = `pos_backup_${timestamp}.dump`
const filepath = path.join(backupDir, filename)

try {
  execSync(`pg_dump "${process.env.DATABASE_URL}" -Fc -f "${filepath}"`)
  console.log(`Backup created: ${filepath}`)
} catch (err) {
  console.error('Backup failed:', errorMessage(err))
  process.exit(1)
}
