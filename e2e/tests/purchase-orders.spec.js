const { test, expect } = require('@playwright/test')
const { login, apiAuth } = require('./helpers')

test('manager orders stock from a supplier and receives it in two deliveries', async ({ page, request }) => {
  const headers = await apiAuth(request, 'manager')
  const stockOf = async () => (await (await request.get('/api/products?search=BEV-001', { headers })).json()).data[0].quantity
  const before = await stockOf()

  await login(page, 'manager')
  await page.goto('/purchase-orders')
  await page.getByRole('button', { name: 'New purchase order' }).click()

  const form = page.getByRole('dialog', { name: 'New purchase order' })
  await form.getByLabel('Supplier').selectOption({ label: 'ECCBC Ghana Ltd' })
  await form.getByLabel('Add a product').fill('BEV-001')
  await form.getByRole('button', { name: /Coca-Cola 500ml/ }).click()
  await form.getByLabel('Quantity of Coca-Cola 500ml').fill('24')
  await form.getByLabel('Unit cost of Coca-Cola 500ml').fill('3.25')
  await expect(form.getByText('GH₵ 78.00').first()).toBeVisible() // 24 × 3.25
  await form.getByRole('button', { name: 'Place order' }).click()

  // The new order opens straight away, ready to receive
  const detail = page.getByRole('dialog', { name: /Purchase order PO-\d{8}-\d{4}/ })
  const status = detail.locator('span.rounded-full')
  await expect(status).toHaveText('Ordered')
  await detail.getByLabel('Quantity of Coca-Cola 500ml received').fill('10')
  await detail.getByRole('button', { name: 'Receive 10 units into stock' }).click()
  await expect(status).toHaveText('Part received')
  expect(await stockOf()).toBe(before + 10)

  // The rest arrives later; the form starts with what is still outstanding
  await expect(detail.getByLabel('Quantity of Coca-Cola 500ml received')).toHaveValue('14')
  await detail.getByRole('button', { name: 'Receive 14 units into stock' }).click()
  await expect(status).toHaveText('Received')
  expect(await stockOf()).toBe(before + 24)
})
