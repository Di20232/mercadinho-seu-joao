const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔄 Simulando fluxos de dados...\n');

    // 1. Criar produtos
    console.log('📦 Criando produtos...');
    const products = await prisma.product.createMany({
      data: [
        { name: 'Arroz Integral 5kg', barcode: 'ARR001', costPrice: 18.00, salePrice: 25.00, category: 'Alimentos', expiryDate: new Date('2026-12-31') },
        { name: 'Feijão Carioca 1kg', barcode: 'FEI001', costPrice: 5.00, salePrice: 8.50, category: 'Alimentos', expiryDate: new Date('2026-12-31') },
        { name: 'Açúcar Cristal 1kg', barcode: 'ACU001', costPrice: 3.50, salePrice: 5.50, category: 'Alimentos', expiryDate: new Date('2026-12-31') },
        { name: 'Óleo de Soja 900ml', barcode: 'OLE001', costPrice: 4.00, salePrice: 6.50, category: 'Alimentos', expiryDate: new Date('2026-12-31') },
        { name: 'Leite Integral 1L', barcode: 'LEI001', costPrice: 3.50, salePrice: 5.00, category: 'Laticínios', expiryDate: new Date('2026-10-25') },
        { name: 'Pão Francês 500g', barcode: 'PAO001', costPrice: 2.00, salePrice: 3.50, category: 'Padaria', expiryDate: new Date('2026-10-10') },
        { name: 'Café Torrado 500g', barcode: 'CAF001', costPrice: 6.00, salePrice: 9.99, category: 'Bebidas', expiryDate: new Date('2027-06-30') },
        { name: 'Açúcar Cristal 5kg', barcode: 'ACU002', costPrice: 15.00, salePrice: 22.00, category: 'Alimentos', expiryDate: new Date('2026-12-31') },
      ],
      skipDuplicates: true,
    });
    console.log(`✅ ${products.count} produtos criados\n`);

    // 2. Criar entrada de estoque
    console.log('📥 Criando entrada de estoque...');
    const productList = await prisma.product.findMany({ take: 8 });
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

    for (const product of productList) {
      const quantity = Math.floor(Math.random() * 50) + 50;
      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          type: 'ENTRY',
          quantity,
          previousStock: 0,
          newStock: quantity,
          userId: admin.id,
          reason: 'Entrada inicial de estoque',
        },
      });

      // Atualizar estoque do produto
      await prisma.product.update({
        where: { id: product.id },
        data: { currentStock: quantity },
      });
    }
    console.log(`✅ Estoque inicializado\n`);

    // 3. Simular algumas vendas
    console.log('💰 Simulando vendas...');

    for (let i = 0; i < 5; i++) {
      const randomProducts = [];
      let totalAmount = 0;

      for (let j = 0; j < Math.floor(Math.random() * 3) + 1; j++) {
        const randomProduct = productList[Math.floor(Math.random() * productList.length)];
        const quantity = Math.floor(Math.random() * 5) + 1;
        const unitPrice = parseFloat(randomProduct.salePrice);
        const subtotal = quantity * unitPrice;

        randomProducts.push({
          productId: randomProduct.id,
          quantity,
          unitPrice,
          subtotal,
        });

        totalAmount += subtotal;
      }

      const sale = await prisma.sale.create({
        data: {
          sellerId: admin.id,
          totalAmount,
          items: {
            create: randomProducts,
          },
        },
        include: { items: true },
      });

      // Atualizar estoque após venda
      for (const item of sale.items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        const newStock = parseFloat(product.currentStock) - parseFloat(item.quantity);

        await prisma.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'SALE',
            quantity: item.quantity,
            previousStock: product.currentStock,
            newStock,
            userId: admin.id,
            saleId: sale.id,
          },
        });

        await prisma.product.update({
          where: { id: item.productId },
          data: { currentStock: newStock },
        });
      }

      console.log(`  Venda #${i + 1}: ${sale.items.length} itens - R$ ${totalAmount.toFixed(2)}`);
    }
    console.log(`✅ 5 vendas simuladas\n`);

    // 4. Listar dados finais
    console.log('📊 Resumo dos dados:');
    const productCount = await prisma.product.count();
    const saleCount = await prisma.sale.count();
    const stockMovements = await prisma.stockMovement.findMany();

    console.log(`  📦 Total de produtos: ${productCount}`);
    console.log(`  💰 Total de vendas: ${saleCount}`);
    console.log(`  📊 Total de movimentações: ${stockMovements.length}`);
    console.log('\n✅ Simulação concluída com sucesso!');
  } catch (e) {
    console.error('❌ Erro:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
