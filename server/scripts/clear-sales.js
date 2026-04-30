/**
 * clear-sales.js
 *
 * Deletes all sales-related records from the database in the correct order
 * to satisfy foreign-key constraints, then resets customer loyalty points.
 *
 * Safe to run at any time — products, customers, categories, users, and
 * settings are left completely untouched.
 *
 * Usage:  npm run clear-sales
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function clearSales() {
  console.log('=== QuickMart — Clear Sales Data ===\n')

  // 1. Payments (FK → Sale)
  const { count: payments } = await prisma.payment.deleteMany()
  console.log(`✓  Deleted ${payments} payment record${payments !== 1 ? 's' : ''}`)

  // 2. SaleItems (FK → Sale, Product)
  const { count: saleItems } = await prisma.saleItem.deleteMany()
  console.log(`✓  Deleted ${saleItems} sale item record${saleItems !== 1 ? 's' : ''}`)

  // 3. InventoryLogs created by sales or refunds
  const { count: logs } = await prisma.inventoryLog.deleteMany({
    where: { change_type: { in: ['SALE', 'REFUND'] } },
  })
  console.log(`✓  Deleted ${logs} inventory log entr${logs !== 1 ? 'ies' : 'y'} (SALE / REFUND)`)

  // 4. Sales
  const { count: sales } = await prisma.sale.deleteMany()
  console.log(`✓  Deleted ${sales} sale record${sales !== 1 ? 's' : ''}`)

  // 5. Reset customer loyalty points (they were earned from the deleted sales)
  const { count: customers } = await prisma.customer.updateMany({
    data: { loyalty_points: 0 },
  })
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
  console.log('    Products, customers, categories, users, and settings are unchanged.')
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
