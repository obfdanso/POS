const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const result = await prisma.product.updateMany({
    data: { image_url: null }
  })
  console.log(`Cleared images from ${result.count} products`)
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())