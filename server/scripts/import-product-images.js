require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

const SOURCE_DIR = path.join(__dirname, '..', 'product-images')
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'products')
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

async function run() {
  // Verify source folder exists
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(
      'ERROR: Folder "server/product-images/" does not exist.\n' +
      'Create it, add your product images named by SKU (e.g. BEV-001.jpg), then re-run the script.'
    )
    process.exit(1)
  }

  // Ensure uploads destination exists
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })

  const files = fs.readdirSync(SOURCE_DIR)

  let imported = 0
  let skipped = 0

  for (const file of files) {
    const ext = path.extname(file).toLowerCase()

    // Silently ignore non-image files (e.g. .DS_Store, README.md)
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      if (ext !== '') {
        console.warn(`  WARN  Unsupported file type, skipping: ${file}`)
      }
      continue
    }

    // Extract SKU from filename (strip extension)
    const sku = path.basename(file, ext)

    // Look up the product
    let product
    try {
      product = await prisma.product.findUnique({ where: { sku } })
    } catch (err) {
      console.error(`  FAIL  Database error looking up SKU "${sku}": ${err.message}`)
      skipped++
      continue
    }

    if (!product) {
      console.warn(`  SKIP  No product found with SKU: ${sku}`)
      skipped++
      continue
    }

    // Build destination filename and path
    const timestamp = Date.now()
    const safeSku = sku.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const newFilename = `product-${safeSku}-${timestamp}${ext}`
    const destPath = path.join(UPLOADS_DIR, newFilename)

    // Copy the image
    try {
      fs.copyFileSync(path.join(SOURCE_DIR, file), destPath)
    } catch (err) {
      console.error(`  FAIL  Could not copy "${file}": ${err.message}`)
      skipped++
      continue
    }

    // Update the database
    const dbImageUrl = `/uploads/products/${newFilename}`
    try {
      await prisma.product.update({
        where: { id: product.id },
        data: { image_url: dbImageUrl },
      })
    } catch (err) {
      console.error(`  FAIL  Database update failed for "${sku}": ${err.message}`)
      // Clean up the copied file so we don't leave orphans
      fs.rmSync(destPath, { force: true })
      skipped++
      continue
    }

    console.log(`  OK    ${product.name} (${sku}) → ${newFilename}`)
    imported++
  }

  console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}`)
}

run()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
