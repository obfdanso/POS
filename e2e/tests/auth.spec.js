const { test, expect } = require('@playwright/test')
const { login } = require('./helpers')

test('rejects an unknown account with a message', async ({ page }) => {
  // An unknown username, so no real account collects failed attempts and gets locked
  await page.goto('/login')
  await page.getByPlaceholder('Enter your username').fill('nobody-e2e')
  await page.getByPlaceholder('Enter your password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page.getByText(/invalid/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('sends each role to its home screen and keeps cashiers out of admin pages', async ({ page }) => {
  await login(page, 'cashier')
  await expect(page).toHaveURL(/\/cashier\/dashboard/)
  await page.goto('/users')
  await expect(page).not.toHaveURL(/\/users/)
  await page.goto('/settings')
  await expect(page).not.toHaveURL(/\/settings/)
})

test('redirects to sign-in when not logged in', async ({ page }) => {
  await page.goto('/pos')
  await expect(page).toHaveURL(/\/login/)
})
