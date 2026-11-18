const { expect } = require('@playwright/test')

// Seeded accounts (server/prisma/seed.js)
const USERS = {
  admin: { username: 'admin', password: 'admin123' },
  manager: { username: 'manager', password: 'manager123' },
  cashier: { username: 'cashier', password: 'cashier123' },
}

async function login(page, role) {
  await page.goto('/login')
  await page.getByPlaceholder('Enter your username').fill(USERS[role].username)
  await page.getByPlaceholder('Enter your password').fill(USERS[role].password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// The seed requires an open shift to sell; open one if this user has none yet
async function ensureShiftOpen(page) {
  const banner = page.getByText('Open a shift and count your opening float')
  await expect(page.getByPlaceholder(/Search by name, SKU/)).toBeVisible()
  if (await banner.isVisible()) {
    await page.getByRole('button', { name: 'Open shift' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Open shift' })
    await dialog.getByLabel('Opening float').fill('100')
    await dialog.getByRole('button', { name: 'Open shift' }).click()
    await expect(banner).toBeHidden()
  }
}

/** Signs in through the API and returns a bearer-token header, for setting up data quickly. */
async function apiAuth(request, role) {
  const res = await request.post('/api/auth/login', { data: USERS[role] })
  expect(res.ok()).toBeTruthy()
  const { data } = await res.json()
  return { Authorization: `Bearer ${data.accessToken}` }
}

module.exports = { USERS, login, ensureShiftOpen, apiAuth }
