const { test, expect } = require('@playwright/test')
const { login, ensureShiftOpen, apiAuth } = require('./helpers')

const STAMP = Date.now()
const CATEGORY = 'E2E Juices'
let created = []

test.beforeAll(async ({ request }) => {
  const headers = await apiAuth(request, 'manager')
  // Reuse the category from an earlier run
  await request.post('/api/categories', { headers, data: { name: CATEGORY } })
  const category = (await (await request.get('/api/categories', { headers })).json()).data.find((c) => c.name === CATEGORY)
  const product = (data) => request.post('/api/products', { headers, data: { category_id: category.id, quantity: 20, ...data } }).then((r) => r.json())
  const main = (await product({ name: 'E2E Mango Juice 500ml', sku: `E2E-MANGO-${STAMP}`, price: 6, variant_name: '500ml' })).data
  const big = (await product({ name: 'E2E Mango Juice 1L', sku: `E2E-MANGO-1L-${STAMP}`, price: 10.5, parent_id: main.id, variant_name: '1L' })).data
  created = [main, big]
})

// Leave nothing new on the till for later runs
test.afterAll(async ({ request }) => {
  const headers = await apiAuth(request, 'admin')
  for (const p of created) await request.delete(`/api/products/${p.id}`, { headers })
})

test('the till offers a product\'s variants and adds the one picked', async ({ page }) => {
  await login(page, 'cashier')
  await page.goto('/pos')
  await ensureShiftOpen(page)

  await page.getByRole('button', { name: CATEGORY, exact: true }).click()
  const card = page.getByRole('button', { name: /E2E Mango Juice 500ml/ })
  await expect(card).toContainText('2 options')
  await card.click()

  const picker = page.getByRole('dialog', { name: 'Choose E2E Mango Juice 500ml' })
  await picker.getByRole('button', { name: /1L/ }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByText('E2E Mango Juice 1L')).toBeVisible()
})
