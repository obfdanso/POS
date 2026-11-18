const { test, expect } = require('@playwright/test')
const { login, apiAuth } = require('./helpers')

test('manager returns one item from a sale and prints the refund slip', async ({ page, request }) => {
  // Ring up a two-item sale through the API so the test starts from a known sale
  const headers = await apiAuth(request, 'manager')
  await request.post('/api/shifts/open', { headers, data: { opening_float: 100 } }) // 409 if already open
  const products = (await (await request.get('/api/products?search=BEV-001', { headers })).json()).data
  const sold = await request.post('/api/sales', {
    headers,
    data: { items: [{ product_id: products[0].id, quantity: 2 }], payment_method: 'CASH', amount_paid: 1000 },
  })
  expect(sold.status()).toBe(201)
  const sale = (await sold.json()).data

  await login(page, 'manager')
  await page.goto('/sales')
  await page.getByPlaceholder('e.g. TXN').fill(sale.transaction_id)
  await page.getByRole('cell', { name: sale.transaction_id }).click()

  const detail = page.getByRole('dialog', { name: `Sale ${sale.transaction_id}` })
  await detail.getByRole('button', { name: 'Return / refund' }).click()

  const returns = page.getByRole('dialog', { name: /Return items/ })
  await returns.getByLabel('Quantity of Coca-Cola 500ml to return').fill('1')
  await returns.getByLabel('Reason').fill('Dented can')
  await returns.getByRole('button', { name: /^Refund/ }).click()

  const after = page.getByRole('dialog', { name: `Sale ${sale.transaction_id}` })
  await expect(after.getByText(/Refunded GH₵/)).toBeVisible()
  await expect(after.getByText(/Dented can/)).toBeVisible()

  // The slip opens in a print window
  const [slip] = await Promise.all([
    page.waitForEvent('popup'),
    after.getByRole('button', { name: 'Print slip' }).click(),
  ])
  await expect(slip.getByText('*** REFUND ***')).toBeVisible()
  await expect(slip.getByText('Dented can')).toBeVisible()
})
