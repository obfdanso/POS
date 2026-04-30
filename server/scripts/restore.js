/**
 * Database Restore Script
 * Usage:
 *   npm run db:restore -- --file backups/pos_backup_2026-04-13T10-00-00.dump
 *   node scripts/restore.js --file backups/pos_backup_2026-04-13T10-00-00.dump
 *
 * Supported formats:
 *   .dump  — pg_dump custom format (created by npm run db:backup)
 *   .sql   — plain SQL dump
 */

require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// ── Parse CLI arguments ──────────────────────────────────────────────────────
const args = process.argv.slice(2)
const fileArgIndex = args.indexOf('--file')

if (fileArgIndex === -1 || !args[fileArgIndex + 1]) {
  console.error('Error: Missing required argument --file')
  console.error('')
  console.error('Usage:')
  console.error('  npm run db:restore -- --file backups/pos_backup_2026-04-13T10-00-00.dump')
  console.error('  npm run db:restore -- --file backups/my_backup.sql')
  process.exit(1)
}

const rawFilePath = args[fileArgIndex + 1]

// Resolve relative to server root (one level up from scripts/)
const serverRoot = path.join(__dirname, '..')
const filePath = path.isAbsolute(rawFilePath)
  ? rawFilePath
  : path.resolve(serverRoot, rawFilePath)

// ── Validate file exists ─────────────────────────────────────────────────────
if (!fs.existsSync(filePath)) {
  console.error(`Error: Backup file not found: ${filePath}`)
  process.exit(1)
}

const ext = path.extname(filePath).toLowerCase()
if (ext !== '.dump' && ext !== '.sql') {
  console.error(`Error: Unsupported file format "${ext}". Use .dump or .sql`)
  process.exit(1)
}

// ── Validate DATABASE_URL ────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('Error: DATABASE_URL is not set in .env')
  process.exit(1)
}

// ── Confirm before proceeding ────────────────────────────────────────────────
const filename = path.basename(filePath)
const fileSizeKB = (fs.statSync(filePath).size / 1024).toFixed(1)

console.log('╔════════════════════════════════════════════════════╗')
console.log('║            POS System — Database Restore           ║')
console.log('╚════════════════════════════════════════════════════╝')
console.log('')
console.log(`  Backup file : ${filename}`)
console.log(`  File size   : ${fileSizeKB} KB`)
console.log(`  Format      : ${ext === '.dump' ? 'pg_dump custom format' : 'plain SQL'}`)
console.log(`  Target DB   : ${maskUrl(databaseUrl)}`)
console.log('')
console.log('  WARNING: This will overwrite existing data in the database.')
console.log('')

// ── Run restore ──────────────────────────────────────────────────────────────
try {
  if (ext === '.dump') {
    // pg_restore for custom-format dumps (.dump created by pg_dump -Fc)
    // --clean          : drop objects before recreating them
    // --if-exists      : don't error if objects don't exist yet
    // --no-acl         : skip access privilege statements
    // --no-owner       : skip ownership statements (avoids role issues)
    // --single-transaction : wrap everything in one transaction (all-or-nothing)
    const cmd = `pg_restore --clean --if-exists --no-acl --no-owner --single-transaction --dbname "${databaseUrl}" "${filePath}"`
    console.log('Running pg_restore…')
    execSync(cmd, { stdio: 'inherit' })
  } else {
    // psql for plain SQL dumps
    const cmd = `psql "${databaseUrl}" --file "${filePath}" --single-transaction`
    console.log('Running psql…')
    execSync(cmd, { stdio: 'inherit' })
  }

  console.log('')
  console.log(`✓ Restore completed successfully from: ${filename}`)
  console.log('')
  console.log('  Tip: Restart the server so Prisma picks up the restored data.')
} catch (err) {
  console.error('')
  console.error('✗ Restore failed.')
  console.error('')
  console.error('Common causes:')
  console.error('  • pg_restore / psql is not in your PATH (install PostgreSQL client tools)')
  console.error('  • DATABASE_URL credentials are incorrect')
  console.error('  • The backup file is corrupt or from an incompatible PostgreSQL version')
  console.error('')
  process.exit(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function maskUrl(url) {
  // Hide the password in the URL for display: postgresql://user:***@host:port/db
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return url.replace(/:([^@]+)@/, ':***@')
  }
}
