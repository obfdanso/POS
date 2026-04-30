const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()

const BCRYPT_COST = 12

async function main() {
  console.log('Seeding database...')

  // Clean up existing data (in reverse FK order)
  await prisma.authLog.deleteMany()
  await prisma.inventoryLog.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.saleItem.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()
  await prisma.supplier.deleteMany()
  await prisma.user.deleteMany()
  await prisma.settings.deleteMany()

  // Settings
  await prisma.settings.createMany({
    data: [
      { key: 'store_name', value: 'QuickMart POS' },
      { key: 'store_address', value: '27 Kwame Nkrumah Ave, Kumasi, Ghana' },
      { key: 'store_phone', value: '032-204-1234' },
      { key: 'tax_rate', value: '3' },
      { key: 'loyalty_points_rate', value: '8' },
      { key: 'currency_symbol', value: 'GH₵' },
      { key: 'receipt_footer', value: 'Thank you for choosing QuickMart!' },
    ],
  })
  console.log('Settings created')

  // Staff Users
  const adminHash = await bcrypt.hash('admin123', BCRYPT_COST)
  const managerHash = await bcrypt.hash('manager123', BCRYPT_COST)
  const cashierHash = await bcrypt.hash('cashier123', BCRYPT_COST)

  const [admin, manager, cashier] = await Promise.all([
    prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@quickmart.com',
        password_hash: adminHash,
        full_name: 'Admin User',
        role: 'ADMIN',
      },
    }),
    prisma.user.create({
      data: {
        username: 'manager',
        email: 'manager@quickmart.com',
        password_hash: managerHash,
        full_name: 'Kwame Asante',
        role: 'MANAGER',
      },
    }),
    prisma.user.create({
      data: {
        username: 'cashier',
        email: 'cashier@quickmart.com',
        password_hash: cashierHash,
        full_name: 'Ama Mensah',
        role: 'CASHIER',
      },
    }),
  ])
  console.log('Staff users created')

  // Suppliers — real Ghanaian distributors/manufacturers
  const supplierData = [
    // Beverages
    { name: 'ECCBC Ghana Ltd',                phone: '+233 30 281 2626', email: 'info@eccbc.com',                      address: 'Spintex Road, Accra',                  website: 'www.eccbc.com' },
    { name: 'Guinness Ghana Breweries Ltd',   phone: '+233 302 428000', email: 'GGBL@diageo.com',                       address: 'Kaasi Industrial Area, Kumasi',          website: 'www.diageo.com' },
    { name: 'Voltic Ghana Ltd',               phone: '+233 30 277 4248', email: 'info@volticghana.com',                 address: 'Medie Kotoku Road, Accra',              website: 'www.volticghana.com' },
    { name: 'Bel-Aqua Company Ltd',           phone: '+233 533 633 567', email: 'info@belaqua.com.gh',                  address: 'Kpone, Aflao Road, Accra',              website: 'www.belaqua.com.gh' },
    { name: 'Aquafresh Ghana Ltd',            phone: '+233 302 811 811', email: 'admin@kalyppo.com',                    address: 'Spintex Road, Accra',                  website: 'www.frutelli.com' },
    { name: 'Accra Brewery Ltd',              phone: '+233 30 268 8853', email: 'info@accrabrewery.com.gh',             address: '22 Graphic Road, Accra',               website: 'www.accrabrewery.com.gh' },
    { name: 'Kasapreko Company Ltd',          phone: '+233 302 810 956', email: 'info@kasapreko.com',                   address: 'Baatsonaa, Spintex Road, Accra',        website: 'www.kasapreko.com' },
    { name: 'Special Ice Company Ltd',        phone: '+233 302 772 807', email: 'info@specialicelimited.com',           address: '10 Osubadu Street, Dzorwulu, Accra',    website: 'www.specialicelimited.com' },
    // Snacks & FMCG
    { name: 'Multipro Private Ltd',           phone: '+233 57 030 0000', email: 'info@multiproghana.com',               address: 'Baatsonaa, Spintex Road, Accra',        website: 'www.multiproghana.com' },
    { name: 'GBfoods Ghana Ltd',              phone: '+233 800 446600',  email: 'info@sales.gbfoods.com',               address: 'Atlantic Towers, Airport City, Accra',  website: 'www.thegbfoods.com' },
    { name: 'Gold Coast Matcom Ltd',          phone: '+233 302 221 890', email: 'info@matcomafrica.com',                address: 'C875/3 Water Road, Kanda, Accra',       website: 'www.matcomafrica.com' },
    // Dairy
    { name: 'Nestlé Ghana Ltd',               phone: '+233 302 214901',  email: 'contact@gh.nestle.com',                address: 'South Legon Commercial Area, Accra',    website: 'www.nestle-cwa.com' },
    { name: 'Fan Milk Ltd (Danone)',           phone: '+233 302 210 660', email: 'customerservice.gh@danone.com',        address: '1 Dadeban Road, North Industrial Area, Accra', website: 'fanmilk.danone.com' },
    { name: 'Friesland Ghana Ltd',            phone: '+233 302 760 433', email: 'info@frieslandcampina.com',            address: '10 Ridge Street, Roman Ridge, Accra',  website: 'www.frieslandcampina.com' },
    { name: 'Promasidor Ghana Ltd',           phone: '+233 302 247 435', email: 'gh@promasidor.com',                    address: '43 Dadeban Road, North Industrial Area, Accra', website: 'corporate.promasidor.com' },
    { name: 'Vitamilk Ghana (Union Beverages)', phone: '+233 30 225 1177', email: 'info@vitamilk.com.gh',              address: 'Mantse Boi Street, Weija, Accra',       website: 'www.vitamilk.com.gh' },
    // Household
    { name: 'Unilever Ghana Ltd',             phone: '+233 596 921440',  email: 'CustomerCare.Ghana@Unilever.com',      address: 'Heavy Industrial Area, Tema',           website: 'www.unileverghana.com' },
    { name: 'Reckitt Benckiser Ghana',        phone: '+233 302 661 000', email: 'info.ghana@reckitt.com',               address: 'Tema Industrial Area, Tema',            website: 'www.reckitt.com' },
    { name: 'Beatex Enterprise Ltd',          phone: '+233 302 230 100', email: 'info@beatexcoils.com',                 address: 'Okaishie, Accra',                       website: 'www.beatexcoils.com' },
    // Personal Care
    { name: 'PZ Cussons Ghana Ltd',           phone: '+233 303 302 701', email: 'info.ghana@pzcussons.com',             address: 'Plot 27, Sanyo Road, Tema',             website: 'www.pzcussons.com' },
    { name: 'Colgate-Palmolive Ghana Ltd',    phone: '+233 302 799 785', email: 'info.ghana@colpal.com',                address: 'Kwabena Duffuor Road, Accra',           website: 'www.colgatepalmolive.com' },
    { name: 'Beiersdorf Ghana Ltd',           phone: '+233 302 811 822', email: 'Nivea.Ghana3@Beiersdorf.com',          address: 'Grand Oyeeman Building, Airport City, Accra', website: 'www.nivea.com.gh' },
    { name: 'Darling Hair Ghana',             phone: '+233 302 550 000', email: 'ghana@darlingafrica.com',              address: 'Accra, Ghana',                          website: 'www.darlingafrica.com' },
    // Stationery
    { name: 'Kingdom Books & Stationery Ltd', phone: '+233 506 487 557', email: 'info@kingdomstoreonline.com',          address: 'La-Accra Road (Opp. Swan Clinic), Accra', website: 'www.kingdomstoreonline.com' },
    { name: 'Vista 2000 Ltd',                 phone: '+233 302 243 335', email: 'info@vistaafrica.net',                 address: 'South Industrial Area, Accra',          website: 'vistaafrica.net' },
  ]

  const suppliers = {}
  for (const s of supplierData) {
    const created = await prisma.supplier.create({ data: s })
    suppliers[s.name] = created
  }
  console.log(`${supplierData.length} suppliers created`)

  // Categories
  const categoryData = [
    { name: 'Beverages', description: 'Drinks, water, and juices' },
    { name: 'Snacks', description: 'Biscuits, chips, and confectionery' },
    { name: 'Dairy', description: 'Milk, cheese, and dairy products' },
    { name: 'Household', description: 'Cleaning and household products' },
    { name: 'Personal Care', description: 'Soaps, lotions, and hygiene products' },
    { name: 'Stationery', description: 'Pens, paper, and office supplies' },
  ]

  const categories = {}
  for (const cat of categoryData) {
    const created = await prisma.category.create({ data: cat })
    categories[cat.name] = created
  }
  console.log('Categories created')

  // Products
  const productData = [
    // ── Beverages ──────────────────────────────────────────────────────────
    { name: 'Coca-Cola 500ml',            sku: 'BEV-001', barcode: '5449000000996', category: 'Beverages',    supplier: 'ECCBC Ghana Ltd',                  price:  4.50, cost_price:  3.20, quantity:  95, low_stock_threshold: 18, image_url: '/product-images/BEV-001.jpg' },
    { name: 'Malta Guinness 330ml',        sku: 'BEV-005', barcode: '6001240018104', category: 'Beverages',    supplier: 'Guinness Ghana Breweries Ltd',      price:  6.00, cost_price:  4.20, quantity: 110, low_stock_threshold: 17, image_url: '/product-images/BEV-005.jpg' },
    { name: 'Voltic Water 1.5L',           sku: 'BEV-003', barcode: '6009521400025', category: 'Beverages',    supplier: 'Voltic Ghana Ltd',                  price:  6.50, cost_price:  4.50, quantity:  75, low_stock_threshold: 18, image_url: '/product-images/BEV-003.jpg' },
    { name: 'Bel-Aqua Sachet Water 500ml', sku: 'BEV-011', barcode: '6009521300025', category: 'Beverages',    supplier: 'Bel-Aqua Company Ltd',              price:  1.50, cost_price:  0.90, quantity: 165, low_stock_threshold: 28, image_url: '/product-images/BEV-011.jpg' },
    { name: 'Kalyppo Juice Box 250ml',     sku: 'BEV-012', barcode: '6009521300032', category: 'Beverages',    supplier: 'Aquafresh Ghana Ltd',               price:  3.00, cost_price:  1.90, quantity:  88, low_stock_threshold: 22, image_url: '/product-images/BEV-012.jpg' },
    { name: 'Don Simon Juice 1L',          sku: 'BEV-013', barcode: '8410179020015', category: 'Beverages',    supplier: 'Gold Coast Matcom Ltd',             price: 16.50, cost_price: 11.50, quantity:  45, low_stock_threshold: 10, image_url: '/product-images/BEV-013.jpg' },
    { name: 'Rush Energy Drink 250ml',     sku: 'BEV-014', barcode: '6009521300049', category: 'Beverages',    supplier: 'Kasapreko Company Ltd',             price:  5.50, cost_price:  3.70, quantity:  65, low_stock_threshold: 13, image_url: '/product-images/BEV-014.jpg' },
    { name: 'Beta Malt 330ml',             sku: 'BEV-015', barcode: '6009521300056', category: 'Beverages',    supplier: 'Accra Brewery Ltd',                 price:  5.00, cost_price:  3.50, quantity: 120, low_stock_threshold: 18, image_url: '/product-images/BEV-015.jpg' },
    { name: 'Frutelli Juice 500ml',        sku: 'BEV-016', barcode: '6009521300063', category: 'Beverages',    supplier: 'Aquafresh Ghana Ltd',               price:  4.50, cost_price:  3.00, quantity:   8, low_stock_threshold: 15, image_url: '/product-images/BEV-016.jpg' },
    { name: 'Special Ice Water 1.5L',      sku: 'BEV-017', barcode: '6009521300070', category: 'Beverages',    supplier: 'Special Ice Company Ltd',           price:  5.50, cost_price:  3.50, quantity: 108, low_stock_threshold: 22, image_url: '/product-images/BEV-017.jpg' },

    // ── Snacks ─────────────────────────────────────────────────────────────
    { name: 'Pringles Original 165g',        sku: 'SNK-001', barcode: '5053990101527', category: 'Snacks', supplier: 'Gold Coast Matcom Ltd',   price: 30.50, cost_price: 22.00, quantity:  52, low_stock_threshold: 10, image_url: '/product-images/SNK-001.jpg' },
    { name: 'TomTom Candy 100g',             sku: 'SNK-003', barcode: '6009507140079', category: 'Snacks', supplier: 'Gold Coast Matcom Ltd',   price:  3.50, cost_price:  2.20, quantity:  55, low_stock_threshold: 12, image_url: '/product-images/SNK-003.jpg' },
    { name: 'Indomie Noodles 70g',           sku: 'SNK-005', barcode: '8850987141009', category: 'Snacks', supplier: 'Multipro Private Ltd',    price:  3.50, cost_price:  2.20, quantity: 168, low_stock_threshold: 32, image_url: '/product-images/SNK-005.jpg' },
    { name: 'Nkatie Cake Groundnut Bar 100g',sku: 'SNK-011', barcode: '6009507040079', category: 'Snacks', supplier: 'Gold Coast Matcom Ltd',   price:  2.50, cost_price:  1.50, quantity:  82, low_stock_threshold: 18, image_url: '/product-images/SNK-011.jpg' },
    { name: 'Habanero Chips 50g',            sku: 'SNK-012', barcode: '6009507040086', category: 'Snacks', supplier: 'Gold Coast Matcom Ltd',   price:  4.50, cost_price:  2.90, quantity: 115, low_stock_threshold: 22, image_url: '/product-images/SNK-012.jpg' },
    { name: "Kellogg's Coco Pops 350g",      sku: 'SNK-013', barcode: '5010029007744', category: 'Snacks', supplier: 'Gold Coast Matcom Ltd',   price: 32.50, cost_price: 22.50, quantity:  32, low_stock_threshold:  6, image_url: '/product-images/SNK-013.jpg' },
    { name: 'Exeter Corned Beef 340g',       sku: 'SNK-014', barcode: '5010029007751', category: 'Snacks', supplier: 'Gold Coast Matcom Ltd',   price: 32.00, cost_price: 22.00, quantity:  38, low_stock_threshold:  8, image_url: '/product-images/SNK-014.jpg' },
    { name: 'Gino Tomato Paste 400g',        sku: 'SNK-015', barcode: '6009507040093', category: 'Snacks', supplier: 'GBfoods Ghana Ltd',       price:  7.50, cost_price:  5.00, quantity:  95, low_stock_threshold: 17, image_url: '/product-images/SNK-015.jpg' },
    { name: 'Obaapa Shito 250g',             sku: 'SNK-016', barcode: '6009507040109', category: 'Snacks', supplier: 'Gold Coast Matcom Ltd',   price: 13.50, cost_price:  9.00, quantity:  45, low_stock_threshold: 10, image_url: '/product-images/SNK-016.jpg' },
    { name: 'Minimie Chin-Chin 100g',        sku: 'SNK-017', barcode: '6009507040116', category: 'Snacks', supplier: 'Multipro Private Ltd',    price:  5.50, cost_price:  3.50, quantity: 140, low_stock_threshold: 27, image_url: '/product-images/SNK-017.jpg' },

    // ── Dairy ──────────────────────────────────────────────────────────────
    { name: 'Peak Milk Powder 400g', sku: 'DAI-001', barcode: '6001240001267', category: 'Dairy', supplier: 'Friesland Ghana Ltd',              price: 29.50, cost_price: 21.50, quantity:  22, low_stock_threshold:  6, image_url: '/product-images/DAI-001.jpg' },
    { name: 'Vitamilk 250ml',        sku: 'DAI-005', barcode: '6001240005012', category: 'Dairy', supplier: 'Vitamilk Ghana (Union Beverages)', price:  5.50, cost_price:  3.70, quantity:  72, low_stock_threshold: 14, image_url: '/product-images/DAI-005.jpg' },
    { name: 'Cowbella Milk 500ml',   sku: 'DAI-006', barcode: '6001240005029', category: 'Dairy', supplier: 'Promasidor Ghana Ltd',             price:  7.50, cost_price:  5.00, quantity:  35, low_stock_threshold:  8, image_url: '/product-images/DAI-006.jpg' },
    { name: 'Ideal Milk Tin 170g',   sku: 'DAI-011', barcode: '6001240001281', category: 'Dairy', supplier: 'Nestlé Ghana Ltd',                 price:  8.50, cost_price:  5.80, quantity:  48, low_stock_threshold: 10, image_url: '/product-images/DAI-011.jpg' },
    { name: 'Nido Milk Powder 400g', sku: 'DAI-012', barcode: '7613035746978', category: 'Dairy', supplier: 'Nestlé Ghana Ltd',                 price: 42.00, cost_price: 30.00, quantity:   3, low_stock_threshold:  6, image_url: '/product-images/DAI-012.jpg' },
    { name: 'Milo Sachet 50g',       sku: 'DAI-013', barcode: '7613035134522', category: 'Dairy', supplier: 'Nestlé Ghana Ltd',                 price:  4.50, cost_price:  2.90, quantity: 135, low_stock_threshold: 28, image_url: '/product-images/DAI-013.jpg' },
    { name: 'Camel Milk 500ml',      sku: 'DAI-014', barcode: '6001240011106', category: 'Dairy', supplier: 'Gold Coast Matcom Ltd',            price:  7.00, cost_price:  4.70, quantity:  60, low_stock_threshold: 12, image_url: '/product-images/DAI-014.jpg' },
    { name: 'FanYogo 150ml',         sku: 'DAI-015', barcode: '6001240011113', category: 'Dairy', supplier: 'Fan Milk Ltd (Danone)',             price:  3.50, cost_price:  2.20, quantity:  68, low_stock_threshold: 13, image_url: '/product-images/DAI-015.jpg' },

    // ── Household ──────────────────────────────────────────────────────────
    { name: 'Omo Detergent 500g',         sku: 'HOU-001', barcode: '8717163571965', category: 'Household', supplier: 'Unilever Ghana Ltd',       price: 13.50, cost_price:  9.50, quantity:  95, low_stock_threshold: 18, image_url: '/product-images/HOU-001.jpg' },
    { name: 'Morning Fresh 500ml',        sku: 'HOU-005', barcode: '6009521400063', category: 'Household', supplier: 'Unilever Ghana Ltd',       price:  9.50, cost_price:  6.20, quantity:  50, low_stock_threshold: 10, image_url: '/product-images/HOU-005.jpg' },
    { name: 'Dettol Antiseptic 500ml',    sku: 'HOU-004', barcode: '6001087023891', category: 'Household', supplier: 'Reckitt Benckiser Ghana',  price: 20.00, cost_price: 14.00, quantity:  28, low_stock_threshold:  6, image_url: '/product-images/HOU-004.jpg' },
    { name: 'Parazone Bleach 750ml',      sku: 'HOU-011', barcode: '5010167210021', category: 'Household', supplier: 'Reckitt Benckiser Ghana',  price: 10.50, cost_price:  6.80, quantity:  78, low_stock_threshold: 14, image_url: '/product-images/HOU-011.jpg' },
    { name: 'Key Soap Bar',               sku: 'HOU-012', barcode: '6009521300087', category: 'Household', supplier: 'Unilever Ghana Ltd',       price:  4.50, cost_price:  2.80, quantity: 108, low_stock_threshold: 22, image_url: '/product-images/HOU-012.jpg' },
    { name: 'Harpic Toilet Cleaner 500ml',sku: 'HOU-013', barcode: '5011417544228', category: 'Household', supplier: 'Reckitt Benckiser Ghana',  price: 16.50, cost_price: 11.50, quantity:  35, low_stock_threshold:  8, image_url: '/product-images/HOU-013.jpg' },
    { name: 'Mosquito Coil 10pk',         sku: 'HOU-014', barcode: '6009521300094', category: 'Household', supplier: 'Beatex Enterprise Ltd',    price:  6.50, cost_price:  4.30, quantity: 100, low_stock_threshold: 17, image_url: '/product-images/HOU-014.jpg' },
    { name: 'Pepsodent Toothpaste 150ml', sku: 'HOU-015', barcode: '8710447194720', category: 'Household', supplier: 'Unilever Ghana Ltd',       price:  7.50, cost_price:  5.00, quantity:  55, low_stock_threshold: 12, image_url: '/product-images/HOU-015.jpg' },
    { name: 'Neatex Floor Cleaner 1L',    sku: 'HOU-016', barcode: '6009521300100', category: 'Household', supplier: 'Reckitt Benckiser Ghana',  price: 15.00, cost_price: 10.00, quantity:  55, low_stock_threshold: 10, image_url: '/product-images/HOU-016.jpg' },
    { name: 'Vim Scouring Powder 500g',   sku: 'HOU-017', barcode: '8710522632253', category: 'Household', supplier: 'Unilever Ghana Ltd',       price:  5.50, cost_price:  3.50, quantity:  72, low_stock_threshold: 18, image_url: '/product-images/HOU-017.jpg' },

    // ── Personal Care ──────────────────────────────────────────────────────
    { name: 'Dove Soap Bar 90g',          sku: 'PCA-001', barcode: '8712561542497', category: 'Personal Care', supplier: 'Unilever Ghana Ltd',       price:  7.50, cost_price:  5.00, quantity:  85, low_stock_threshold: 18, image_url: '/product-images/PCA-001.jpg' },
    { name: 'Colgate Toothpaste 75ml',    sku: 'PCA-004', barcode: '8714789033815', category: 'Personal Care', supplier: 'Colgate-Palmolive Ghana Ltd',price:  8.50, cost_price:  5.80, quantity:  90, low_stock_threshold: 17, image_url: '/product-images/PCA-004.jpg' },
    { name: 'Nivea Body Lotion 400ml',    sku: 'PCA-011', barcode: '4005900130648', category: 'Personal Care', supplier: 'Beiersdorf Ghana Ltd',      price: 27.00, cost_price: 19.00, quantity:  35, low_stock_threshold:  8, image_url: '/product-images/PCA-011.jpg' },
    { name: 'Geisha Soap Bar 225g',       sku: 'PCA-012', barcode: '6009521300117', category: 'Personal Care', supplier: 'Unilever Ghana Ltd',        price:  5.50, cost_price:  3.60, quantity: 118, low_stock_threshold: 22, image_url: '/product-images/PCA-012.jpg' },
    { name: 'Dax Hair Pomade 100g',       sku: 'PCA-013', barcode: '0041100050024', category: 'Personal Care', supplier: 'Gold Coast Matcom Ltd',     price: 16.00, cost_price: 11.00, quantity:  60, low_stock_threshold: 12, image_url: '/product-images/PCA-013.jpg' },
    { name: 'Cussons Baby Powder 350g',   sku: 'PCA-014', barcode: '8710908542695', category: 'Personal Care', supplier: 'PZ Cussons Ghana Ltd',      price: 11.00, cost_price:  7.50, quantity:  42, low_stock_threshold: 10, image_url: '/product-images/PCA-014.jpg' },
    { name: 'Darling Hair Extension 1pk', sku: 'PCA-015', barcode: '6009521300124', category: 'Personal Care', supplier: 'Darling Hair Ghana',        price: 38.00, cost_price: 26.50, quantity:   2, low_stock_threshold:  6, image_url: '/product-images/PCA-015.jpg' },
    { name: 'Joy Dodi Body Cream 400ml',  sku: 'PCA-016', barcode: '6009521300131', category: 'Personal Care', supplier: 'PZ Cussons Ghana Ltd',      price: 17.00, cost_price: 11.50, quantity:  52, low_stock_threshold: 10, image_url: '/product-images/PCA-016.jpg' },

    // ── Stationery ─────────────────────────────────────────────────────────
    { name: 'Bic Ballpen Blue 10pk',    sku: 'STA-001', barcode: '0070330102013', category: 'Stationery', supplier: 'Kingdom Books & Stationery Ltd', price:  8.50, cost_price:  5.80, quantity:  68, low_stock_threshold: 13, image_url: '/product-images/STA-001.jpg' },
    { name: 'A4 Paper Ream 500 sheets', sku: 'STA-002', barcode: '5901436786641', category: 'Stationery', supplier: 'Vista 2000 Ltd',                price: 57.50, cost_price: 41.50, quantity:  18, low_stock_threshold:  4, image_url: '/product-images/STA-002.jpg' },
    { name: 'Exercise Book 32 Leaves',  sku: 'STA-011', barcode: '6009521300148', category: 'Stationery', supplier: 'Kingdom Books & Stationery Ltd', price:  2.50, cost_price:  1.60, quantity: 175, low_stock_threshold: 32, image_url: '/product-images/STA-011.jpg' },
    { name: 'Mathematical Set',         sku: 'STA-012', barcode: '6009521300155', category: 'Stationery', supplier: 'Kingdom Books & Stationery Ltd', price: 10.50, cost_price:  7.00, quantity:  28, low_stock_threshold:  8, image_url: '/product-images/STA-012.jpg' },
    { name: 'Pencil HB 12pk',           sku: 'STA-013', barcode: '6009521300162', category: 'Stationery', supplier: 'Kingdom Books & Stationery Ltd', price:  6.50, cost_price:  4.20, quantity:  95, low_stock_threshold: 17, image_url: '/product-images/STA-013.jpg' },
    { name: 'Counter Book A4 2-Quire',  sku: 'STA-014', barcode: '6009521300179', category: 'Stationery', supplier: 'Kingdom Books & Stationery Ltd', price: 11.50, cost_price:  7.50, quantity:  48, low_stock_threshold: 10, image_url: '/product-images/STA-014.jpg' },
  ]

  const products = {}
  for (const p of productData) {
    const created = await prisma.product.create({
      data: {
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        category_id: categories[p.category].id,
        supplier_id: suppliers[p.supplier]?.id ?? null,
        price: p.price,
        cost_price: p.cost_price,
        quantity: p.quantity,
        low_stock_threshold: p.low_stock_threshold,
        image_url: p.image_url ?? null,
      },
    })
    products[p.sku] = { ...created, originalQuantity: p.quantity }
  }
  console.log(`${productData.length} products created`)

  // Customer records (no login accounts — customers are for sales/loyalty tracking only)
  const customerData = [
    { name: 'Kwabena Osei-Bonsu',   phone: '024-123-4567', email: 'kwabena.oseibonsu@gmail.com', loyalty_points: 287 },
    { name: 'Abena Boateng',        phone: '050-234-5678', email: 'abena.boateng@yahoo.com',      loyalty_points: 134 },
    { name: 'Nana Yaa Asantewaa',   phone: '026-345-6789', email: 'nanayaa.asantewaa@yahoo.com',  loyalty_points: 300 },
    { name: 'Akosua Frimpong',      phone: '055-456-7890', email: 'akosua.frimpong@gmail.com',    loyalty_points: 211 },
    { name: 'Kobby Antwi-Boasiako', phone: '024-567-8901', email: null,                           loyalty_points:  63 },
    { name: 'Adwoa Mensah',         phone: '050-678-9012', email: 'adwoa.mensah@gmail.com',       loyalty_points: 178 },
    { name: 'Afia Pokua Mensah',    phone: '026-789-0123', email: 'afia.pokua@gmail.com',         loyalty_points:  45 },
    { name: 'Esi Amponsah',         phone: '055-890-1234', email: 'esi.amponsah@yahoo.com',       loyalty_points: 252 },
    { name: 'Kweku Appiah-Kubi',    phone: '024-901-2345', email: 'kweku.appiah@hotmail.com',     loyalty_points:  97 },
    { name: 'Maame Serwaa',         phone: '050-012-3456', email: 'maame.serwaa@gmail.com',       loyalty_points: 163 },
  ]

  const customers = []
  for (const c of customerData) {
    const customer = await prisma.customer.create({
      data: {
        name: c.name,
        phone: c.phone,
        email: c.email,
        loyalty_points: c.loyalty_points,
      },
    })
    customers.push(customer)
  }
  console.log('10 customer records created')

  console.log('Database seeding completed successfully!')
  console.log('')
  console.log('Staff credentials:')
  console.log('  Admin:   admin / admin123')
  console.log('  Manager: manager / manager123')
  console.log('  Cashier: cashier / cashier123')
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
