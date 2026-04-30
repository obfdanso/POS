const prisma = require('../utils/prismaClient')
const { NotFoundError, ValidationError, AppError } = require('../utils/errors')
const { verifyPaystackPayment } = require('../utils/paystack')
const { logger } = require('../middleware/logger')

async function createSale({ items, customer_id, payment_method, amount_paid, discount_amount = 0, notes, reference }, user) {
  // Support legacy callers that pass userId as a string
  const userId = typeof user === 'string' ? user : user.id

  // Step 1: Validate all items exist and have sufficient stock
  const productIds = items.map((i) => i.product_id)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, is_active: true },
  })

  const productMap = new Map(products.map((p) => [p.id, p]))

  for (const item of items) {
    const product = productMap.get(item.product_id)
    if (!product) {
      throw new NotFoundError(`Product ${item.product_id} not found or inactive`)
    }
    if (product.quantity < item.quantity) {
      throw new ValidationError('Insufficient stock', [
        {
          field: 'items',
          message: `Insufficient stock for "${product.name}". Available: ${product.quantity}, requested: ${item.quantity}`,
        },
      ])
    }
  }

  // Step 2: Calculate totals
  const taxRate = await getSettingValue('tax_rate', 0)
  let subtotal = 0
  const saleItems = items.map((item) => {
    const product = productMap.get(item.product_id)
    const unit_price = parseFloat(product.price)
    const itemDiscount = parseFloat(item.discount || 0)
    const lineTotal = unit_price * item.quantity - itemDiscount
    subtotal += lineTotal
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price,
      discount: itemDiscount,
      total: lineTotal,
      product_name: product.name, // for receipt
    }
  })

  const discountAmt = parseFloat(discount_amount) || 0
  const taxableAmount = subtotal - discountAmt
  const taxAmount = parseFloat((taxableAmount * (taxRate / 100)).toFixed(2))
  const totalAmount = parseFloat((taxableAmount + taxAmount).toFixed(2))

  // Validate payment
  const amountPaid = parseFloat(amount_paid)
  if (payment_method === 'CASH' && amountPaid < totalAmount) {
    throw new ValidationError('Insufficient payment', [
      { field: 'amount_paid', message: `Amount paid (${amountPaid}) is less than total (${totalAmount})` },
    ])
  }

  if (payment_method === 'MOBILE_MONEY' || payment_method === 'CARD') {
    if (!reference) {
      throw new ValidationError('Payment reference required', [
        { field: 'reference', message: 'Paystack reference is required for non-cash payments' }
      ])
    }

    let paystackRes;
    try {
      paystackRes = await verifyPaystackPayment(reference);
    } catch (err) {
      throw err instanceof AppError ? err : new AppError('payment verification unavailable', 503);
    }

    if (!paystackRes || paystackRes.status !== true || paystackRes.data?.status !== 'success') {
      throw new ValidationError('Payment verification failed', [
        { field: 'reference', message: 'Paystack transaction not successful' }
      ])
    }

    const paystackAmountPesewas = paystackRes.data.amount;
    // The frontend Paystack popup is initialized with \`Math.round(total * 100)\` where total = subtotal - discount.
    // Tax is calculated later on the backend and NOT included in the Paystack charge by the frontend.
    // Thus we must securely verify against the exact amount the frontend intended to charge.
    const expectedAmountPesewas = Math.round((subtotal - discountAmt) * 100);
    if (Math.abs(paystackAmountPesewas - expectedAmountPesewas) > 1) {
      throw new ValidationError(`Payment verification failed: amount mismatch (Paystack: ${paystackAmountPesewas} pesewas, expected: ${expectedAmountPesewas} pesewas)`, [
        { field: 'amount', message: 'Verified amount does not match total amount' }
      ])
    }

    logger.info(`Paystack verification successful: Ref ${reference}, Amount ${paystackAmountPesewas} pesewas, Channel ${paystackRes.data.channel || 'unknown'}`);
  }

  const changeGiven = payment_method === 'CASH' ? parseFloat((amountPaid - totalAmount).toFixed(2)) : 0

  // Step 3–6: Execute in a single DB transaction
  const runTx = () => prisma.$transaction(async (tx) => {
    // Generate sequential human-readable transaction ID (spec: TXN-YYYYMMDD-NNNN)
    const now = new Date()
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayCount = await tx.sale.count({ where: { created_at: { gte: startOfDay } } })
    const transaction_id = `TXN-${dateStr}-${String(todayCount + 1).padStart(4, '0')}`

    // Create Sale
    const newSale = await tx.sale.create({
      data: {
        transaction_id,
        user_id: userId,
        customer_id: customer_id || null,
        subtotal: parseFloat(subtotal.toFixed(2)),
        discount_amount: discountAmt,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        payment_method,
        payment_status: 'COMPLETED',
        notes: notes || null,
      },
    })

    // Create SaleItems
    await tx.saleItem.createMany({
      data: saleItems.map((si) => ({
        sale_id: newSale.id,
        product_id: si.product_id,
        quantity: si.quantity,
        unit_price: si.unit_price,
        discount: si.discount,
        total: si.total,
      })),
    })

    // Create Payment
    await tx.payment.create({
      data: {
        sale_id: newSale.id,
        method: payment_method,
        amount_paid: amountPaid,
        change_given: changeGiven,
        reference: reference || null,
      },
    })

    // Deduct stock and create inventory logs
    for (const item of saleItems) {
      const product = productMap.get(item.product_id)
      const newQty = product.quantity - item.quantity

      await tx.product.update({
        where: { id: item.product_id },
        data: { quantity: newQty },
      })

      await tx.inventoryLog.create({
        data: {
          product_id: item.product_id,
          change_type: 'SALE',
          quantity_change: -item.quantity,
          previous_quantity: product.quantity,
          new_quantity: newQty,
          user_id: userId,
          notes: `Sale ${transaction_id}`,
        },
      })
    }

    // Award loyalty points if customer is linked (1 point per GHS 10)
    if (customer_id) {
      const loyaltyRate = await getSettingValue('loyalty_points_rate', 10)
      const pointsEarned = loyaltyRate > 0 ? Math.floor(totalAmount / loyaltyRate) : 0
      if (pointsEarned > 0) {
        await tx.customer.update({
          where: { id: customer_id },
          data: { loyalty_points: { increment: pointsEarned } },
        })
      }
    }

    return newSale
  })

  let sale
  try {
    sale = await runTx()
  } catch (err) {
    if (err.code === 'P2002' && err.meta?.target?.toString().includes('transaction_id')) {
      // Extremely rare collision (two concurrent sales in same millisecond) — retry once.
      // The retry re-counts today's committed sales, so it will generate a new unique ID.
      sale = await runTx()
    } else {
      throw err
    }
  }

  // Fetch complete sale with relations
  return getSaleById(sale.id)
}

async function getSaleById(id) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, username: true, full_name: true } },
      customer: { select: { id: true, name: true, phone: true } },
      sale_items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
      payments: true,
    },
  })
  if (!sale) throw new NotFoundError('Sale not found')
  return sale
}

async function listSales({ page = 1, per_page = 20, start_date, end_date, user_id, customer_id } = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where = {}
  if (start_date || end_date) {
    where.created_at = {}
    if (start_date) where.created_at.gte = new Date(start_date)
    if (end_date) {
      const end = new Date(end_date)
      end.setHours(23, 59, 59, 999)
      where.created_at.lte = end
    }
  }
  if (user_id) where.user_id = user_id
  if (customer_id) where.customer_id = customer_id

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      skip,
      take,
      include: {
        user: { select: { id: true, username: true, full_name: true } },
        customer: { select: { id: true, name: true } },
        _count: { select: { sale_items: true } },
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.sale.count({ where }),
  ])

  return { sales, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

async function processRefund(saleId, userId) {
  const sale = await getSaleById(saleId)

  if (sale.payment_status === 'REFUNDED') {
    throw new ValidationError('Sale already refunded', [
      { field: 'sale_id', message: 'This sale has already been refunded' },
    ])
  }

  await prisma.$transaction(async (tx) => {
    // Update sale status
    await tx.sale.update({
      where: { id: saleId },
      data: { payment_status: 'REFUNDED' },
    })

    // Restore stock and create return inventory logs
    for (const item of sale.sale_items) {
      const product = await tx.product.findUnique({ where: { id: item.product_id } })
      const newQty = product.quantity + item.quantity

      await tx.product.update({
        where: { id: item.product_id },
        data: { quantity: newQty },
      })

      await tx.inventoryLog.create({
        data: {
          product_id: item.product_id,
          change_type: 'RETURN',
          quantity_change: item.quantity,
          previous_quantity: product.quantity,
          new_quantity: newQty,
          user_id: userId,
          notes: `Refund for sale ${sale.transaction_id}`,
        },
      })
    }

    // Reverse loyalty points
    if (sale.customer_id) {
      const loyaltyRate = await getSettingValue('loyalty_points_rate', 10)
      const pointsToDeduct = loyaltyRate > 0 ? Math.floor(parseFloat(sale.total_amount) / loyaltyRate) : 0
      if (pointsToDeduct > 0) {
        const customer = await tx.customer.findUnique({ where: { id: sale.customer_id } })
        const newPoints = Math.max(0, customer.loyalty_points - pointsToDeduct)
        await tx.customer.update({ where: { id: sale.customer_id }, data: { loyalty_points: newPoints } })
      }
    }
  })

  return getSaleById(saleId)
}

async function getReceiptData(saleId) {
  const sale = await getSaleById(saleId)

  const [storeName, storeAddress, storePhone] = await Promise.all([
    getSettingValue('store_name', 'My Store'),
    getSettingValue('store_address', ''),
    getSettingValue('store_phone', ''),
  ])

  return {
    store: { name: storeName, address: storeAddress, phone: storePhone },
    sale,
  }
}

async function getSettingValue(key, defaultValue) {
  try {
    const setting = await prisma.settings.findUnique({ where: { key } })
    if (!setting) return defaultValue
    const val = parseFloat(setting.value)
    return isNaN(val) ? setting.value : val
  } catch {
    return defaultValue
  }
}

module.exports = { createSale, getSaleById, listSales, processRefund, getReceiptData }
