/**
 * unlock-user.js
 *
 * Recovery tool for when every admin is locked out after failed logins.
 * Clears the lock and failed-attempt counter for one user.
 *
 * Usage:  npm run unlock-user -- <username>
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function unlockUser() {
  const username = process.argv[2]
  if (!username) {
    console.error('Usage: npm run unlock-user -- <username>')
    process.exit(1)
  }

  const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } })
  if (!user) {
    console.error(`No user found with username "${username}"`)
    process.exit(1)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failed_login_attempts: 0, locked_until: null },
  })
  await prisma.authLog.create({
    data: { user_id: user.id, event_type: 'ACCOUNT_UNLOCKED', details: 'Unlocked from server console (unlock-user script)' },
  })
  console.log(`Unlocked ${user.username} (${user.role})`)
}

unlockUser()
  .catch((e) => {
    console.error('unlock-user failed:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
