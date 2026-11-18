const { test, expect } = require('@playwright/test')
const { login, ensureShiftOpen } = require('./helpers')

test('a cash sale made with no connection is saved and sent when it comes back', async ({ page, context }) => {
  await login(page, 'cashier')
  await page.goto('/pos')
  await ensureShiftOpen(page)

  const search = page.getByPlaceholder(/Search by name, SKU/)
  await search.fill('BEV-001')
  await search.press('Enter')
  await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeVisible()

  await context.setOffline(true)
  await page.keyboard.press('F2')
  const payment = page.getByRole('dialog')
  await payment.getByRole('button', { name: 'Exact' }).click()
  await payment.getByRole('button', { name: 'Confirm Payment' }).click()
  await expect(page.getByText(/1 sale\(s\) saved offline/)).toBeVisible()

  // Coming back online sends it
  await context.setOffline(false)
  await expect(page.getByText(/sent to the server/)).toBeVisible()
  await expect(page.getByText(/saved offline, waiting/)).toBeHidden()
})
