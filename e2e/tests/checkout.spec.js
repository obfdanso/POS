const { test, expect } = require('@playwright/test')
const { login, ensureShiftOpen } = require('./helpers')

test('cashier scans a product and completes a cash sale with the keyboard', async ({ page }) => {
  await login(page, 'cashier')
  await page.goto('/pos')
  await ensureShiftOpen(page)

  // A barcode scanner types the code and presses Enter; a SKU works the same way
  const search = page.getByPlaceholder(/Search by name, SKU/)
  await search.fill('BEV-001')
  await search.press('Enter')
  await expect(page.getByLabel('Quantity of Coca-Cola 500ml')).toHaveValue('1')
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await expect(page.getByLabel('Quantity of Coca-Cola 500ml')).toHaveValue('2')

  await page.keyboard.press('F2')
  const payment = page.getByRole('dialog')
  await payment.getByRole('button', { name: 'Exact' }).click()
  await payment.getByRole('button', { name: 'Confirm Payment' }).click()

  const receipt = page.getByRole('dialog', { name: /Receipt/ })
  await expect(receipt).toBeVisible()
  await expect(receipt.getByText(/TXN-\d{8}-\d{4}/)).toBeVisible()
  await expect(receipt.getByText('Coca-Cola 500ml')).toBeVisible()
  await expect(receipt.getByText('CASH', { exact: true })).toBeVisible()
})

test('the Charge button stays disabled with an empty cart', async ({ page }) => {
  await login(page, 'cashier')
  await page.goto('/pos')
  await ensureShiftOpen(page)
  await expect(page.getByRole('button', { name: /Charge/ })).toBeDisabled()
})
