const { test, expect } = require('@playwright/test')
const { login, ensureShiftOpen, apiAuth } = require('./helpers')

const NAME = `E2E Cola Deal ${Date.now()}`

// A running promotion changes every later sale of that product, so always switch it off again
test.afterAll(async ({ request }) => {
  const headers = await apiAuth(request, 'manager')
  const all = (await (await request.get('/api/promotions', { headers })).json()).data
  for (const p of all.filter((p) => p.name.startsWith('E2E ') && p.is_active)) {
    await request.put(`/api/promotions/${p.id}`, { headers, data: { is_active: false } })
  }
})

test('a promotion created by a manager is applied at the till and shown on the receipt', async ({ page }) => {
  await login(page, 'manager')
  await page.goto('/promotions')
  await page.getByRole('button', { name: 'New promotion' }).click()

  const form = page.getByRole('dialog', { name: 'New promotion' })
  await form.getByLabel('Name (shown on receipts)').fill(NAME)
  await form.getByLabel('Percent off').fill('20')
  await form.getByLabel('Applies to').selectOption('product')
  await form.getByLabel('Product').fill('BEV-001')
  await form.getByRole('button', { name: /Coca-Cola 500ml/ }).click()
  await form.getByRole('button', { name: 'Create promotion' }).click()
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toContainText('Running')

  // The till picks it up: 2 × 4.50 = 9.00, less 20% = 7.20 (before tax)
  await page.goto('/pos')
  await ensureShiftOpen(page)
  const search = page.getByPlaceholder(/Search by name, SKU/)
  await search.fill('BEV-001')
  await search.press('Enter')
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await expect(page.getByText(`${NAME} · 20% off · -GH₵ 1.80`)).toBeVisible()

  await page.keyboard.press('F2')
  const payment = page.getByRole('dialog')
  await payment.getByRole('button', { name: 'Exact' }).click()
  await payment.getByRole('button', { name: 'Confirm Payment' }).click()

  const receipt = page.getByRole('dialog', { name: /Receipt/ })
  await expect(receipt.getByText(NAME)).toBeVisible()
  await expect(receipt.getByText('-GH₵ 1.80')).toBeVisible()
})
