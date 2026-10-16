/**
 * clear-sales.js
 *
 * Deletes all sales, sale items, payments, and SALE/RETURN inventory logs in one
 * transaction, puts the sold stock back so stock levels still match the remaining
 * inventory history, and resets customer loyalty points (earned from those sales).
 * Products, customers, categories, users, and settings are otherwise kept.
 *
 * Usage:  npm run clear-sales
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function clearSales() {
  console.log('=== QuickMart — Clear Sales Data ===\n')

  const result = await prisma.$transaction(async (tx) => {
    // 1. Put sold stock back: undo the net effect of every SALE / RETURN log per product,
    //    so stock levels still match the remaining (restock / adjustment) history
    const netByProduct = await tx.inventoryLog.groupBy({
      by: ['product_id'],
      where: { change_type: { in: ['SALE', 'RETURN'] } },
      _sum: { quantity_change: true },
    })
    let restocked = 0
    for (const row of netByProduct) {
      const units = -(row._sum.quantity_change || 0)
      if (units !== 0) {
        await tx.product.update({ where: { id: row.product_id }, data: { quantity: { increment: units } } })
        restocked++
      }
    }

    // 2. Delete in foreign-key order
    const { count: payments } = await tx.payment.deleteMany()
    const { count: saleItems } = await tx.saleItem.deleteMany()
    const { count: logs } = await tx.inventoryLog.deleteMany({ where: { change_type: { in: ['SALE', 'RETURN'] } } })
    const { count: sales } = await tx.sale.deleteMany()

    // 3. Loyalty points were earned from the deleted sales
    const { count: customers } = await tx.customer.updateMany({ data: { loyalty_points: 0 } })

    return { payments, saleItems, logs, sales, customers, restocked }
  })

  const { payments, saleItems, logs, sales, customers, restocked } = result
  console.log(`✓  Restored sold stock for ${restocked} product${restocked !== 1 ? 's' : ''}`)
  console.log(`✓  Deleted ${payments} payment record${payments !== 1 ? 's' : ''}`)
  console.log(`✓  Deleted ${saleItems} sale item record${saleItems !== 1 ? 's' : ''}`)
  console.log(`✓  Deleted ${logs} inventory log entr${logs !== 1 ? 'ies' : 'y'} (SALE / RETURN)`)
  console.log(`✓  Deleted ${sales} sale record${sales !== 1 ? 's' : ''}`)
  console.log(`✓  Reset loyalty points to 0 for ${customers} customer${customers !== 1 ? 's' : ''}`)

  console.log('\n────────────────────────────────────────')
  console.log('Summary')
  console.log(`  Sales deleted        : ${sales}`)
  console.log(`  Payments deleted     : ${payments}`)
  console.log(`  Sale items deleted   : ${saleItems}`)
  console.log(`  Inventory logs deleted: ${logs}`)
  console.log(`  Customers reset      : ${customers}`)
  console.log('────────────────────────────────────────')
  console.log('\n✅  Database is clean.')
  console.log('    Sold stock was put back; products, customers, categories, users, and settings are kept.')
  console.log('    Run "npm run db:seed" if you want to start completely from scratch.\n')
}

clearSales()
  .catch((e) => {
    console.error('\n❌  clear-sales failed:', e.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
