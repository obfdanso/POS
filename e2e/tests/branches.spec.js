const { test, expect } = require('@playwright/test')
const { login, ensureShiftOpen, apiAuth } = require('./helpers')

// A fresh branch each run; codes are 2-6 capital letters
const STAMP = Date.now().toString(36).toUpperCase().replace(/[^A-Z]/g, '').slice(-3).padEnd(3, 'X')
const NAME = `E2E Branch ${STAMP}`
const CODE = `E${STAMP}`
let branchId

const stockAt = async (request, headers, branch) => {
  const res = await request.get('/api/inventory?search=BEV-001', { headers: { ...headers, 'X-Branch-Id': branch } })
  return (await res.json()).data.find((row) => row.sku === 'BEV-001')?.quantity
}

test.beforeAll(async ({ request }) => {
  // The admin may still have a drawer open from an earlier run; this test opens one at the new branch
  const headers = await apiAuth(request, 'admin')
  const current = (await (await request.get('/api/shifts/current', { headers })).json()).data
  if (current) await request.post(`/api/shifts/${current.id}/close`, { headers, data: { counted_cash: 0 } })
})

test.afterAll(async ({ request }) => {
  if (!branchId) return
  const headers = await apiAuth(request, 'admin')
  const current = (await (await request.get('/api/shifts/current', { headers })).json()).data
  if (current) await request.post(`/api/shifts/${current.id}/close`, { headers, data: { counted_cash: 0 } })
  await request.put(`/api/branches/${branchId}`, { headers, data: { is_active: false } })
})

test('admin opens a branch, stocks a product there and sells it without touching Kumasi', async ({ page, request }) => {
  const headers = await apiAuth(request, 'admin')
  const branches = (await (await request.get('/api/branches', { headers })).json()).data
  const kumasi = branches.find((b) => b.code === 'KSI')
  const kumasiBefore = await stockAt(request, headers, kumasi.id)

  // Create the branch
  await login(page, 'admin')
  await page.goto('/branches')
  await page.getByRole('button', { name: 'New branch' }).click()
  const form = page.getByRole('dialog', { name: 'New branch' })
  await form.getByLabel('Name').fill(NAME)
  await form.getByLabel('Short code').fill(CODE)
  await form.getByRole('button', { name: 'Create branch' }).click()
  await expect(page.getByRole('cell', { name: NAME })).toBeVisible()
  branchId = (await (await request.get('/api/branches', { headers })).json()).data.find((b) => b.code === CODE).id

  // Stock Coca-Cola there
  const products = (await (await request.get('/api/products?search=BEV-001', { headers })).json()).data
  await page.goto(`/products/${products[0].id}/edit`)
  await page.getByRole('checkbox', { name: NAME }).check()
  await page.getByLabel(`Starting quantity at ${NAME}`).fill('5')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page).toHaveURL(/\/products$/)
  expect(await stockAt(request, headers, branchId)).toBe(5)

  // Work at the new branch and sell one
  await page.getByLabel('Branch', { exact: true }).selectOption({ label: NAME })
  await page.goto('/pos')
  await ensureShiftOpen(page)
  const search = page.getByPlaceholder(/Search by name, SKU/)
  await search.fill('BEV-001')
  await search.press('Enter')
  await expect(page.getByLabel('Quantity of Coca-Cola 500ml')).toHaveValue('1')
  await page.keyboard.press('F2')
  const payment = page.getByRole('dialog')
  await payment.getByRole('button', { name: 'Exact' }).click()
  await payment.getByRole('button', { name: 'Confirm Payment' }).click()
  const receipt = page.getByRole('dialog', { name: /Receipt/ })
  await expect(receipt.getByText(NAME)).toBeVisible()

  expect(await stockAt(request, headers, branchId)).toBe(4)
  expect(await stockAt(request, headers, kumasi.id)).toBe(kumasiBefore)
})

test("switching branch reloads the page with that branch's data", async ({ page }) => {
  await login(page, 'admin')
  await page.goto('/sales')
  await page.getByLabel('Branch', { exact: true }).selectOption({ label: 'All branches' })
  // All branches: Kumasi's sales (rung up by Ama Mensah) are listed
  await expect(page.getByRole('cell', { name: 'Ama Mensah' }).first()).toBeVisible()

  // Switch to Accra on the same page, without navigating
  await page.getByLabel('Branch', { exact: true }).selectOption({ label: 'Accra Mall' })
  await expect(page.getByRole('cell', { name: 'Akosua Boateng' }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Ama Mensah' })).toHaveCount(0)
})
