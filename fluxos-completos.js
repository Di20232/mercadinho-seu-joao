const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║        🔄 SIMULAÇÃO COMPLETA DE FLUXOS DE DADOS 🔄         ║');
    console.log('║           Mercadinho do João - Cenários Reais           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // ==========================================
    // FLUXO 1: Gerenciamento de Usuários
    // ==========================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 FLUXO 1: GERENCIAMENTO DE USUÁRIOS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const existingUsers = await prisma.user.findMany();
    console.log(`✅ Total de usuários no sistema: ${existingUsers.length}`);

    existingUsers.forEach(u => {
      console.log(`   • ${u.name} (${u.email}) - ${u.role}`);
    });

    // ==========================================
    // FLUXO 2: Venda Completa com Múltiplos Itens
    // ==========================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 FLUXO 2: VENDA COMPLETA COM MÚLTIPLOS ITENS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const admin = existingUsers.find(u => u.role === 'ADMIN');
    const products = await prisma.product.findMany({ take: 5 });

    if (products.length > 0 && admin) {
      const saleItems = [];
      let totalAmount = 0;

      for (let i = 0; i < Math.min(3, products.length); i++) {
        const product = products[i];
        const quantity = Math.floor(Math.random() * 5) + 1;
        const unitPrice = parseFloat(product.salePrice);
        const subtotal = quantity * unitPrice;

        saleItems.push({
          productId: product.id,
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
          items: { create: saleItems },
        },
        include: { items: { include: { product: true } } },
      });

      console.log(`🛒 Venda #${sale.id} criada com sucesso!`);
      console.log(`   Vendedor: ${admin.name}`);
      console.log(`   Itens na venda:`);

      sale.items.forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.product.name} - ${item.quantity}x R$ ${item.unitPrice.toFixed(2)} = R$ ${item.subtotal.toFixed(2)}`);
      });

      console.log(`   💰 Total: R$ ${totalAmount.toFixed(2)}`);
      console.log(`   📅 Data: ${sale.createdAt.toLocaleString('pt-BR')}`);

      console.log(`\n📦 Atualizando estoque...`);
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

        console.log(`   ✅ ${item.product.name}: ${product.currentStock} → ${newStock} unidades`);
      }
    }

    // ==========================================
    // FLUXO 3: Ajuste de Estoque Manual
    // ==========================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 FLUXO 3: AJUSTE DE ESTOQUE MANUAL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (products.length > 0 && admin) {
      const productToAdjust = products[0];
      const adjustmentQuantity = -2;
      const currentStock = parseFloat(productToAdjust.currentStock);
      const newStock = currentStock + adjustmentQuantity;

      await prisma.stockMovement.create({
        data: {
          productId: productToAdjust.id,
          type: 'ADJUSTMENT',
          quantity: Math.abs(adjustmentQuantity),
          previousStock: currentStock,
          newStock,
          userId: admin.id,
          reason: 'Produtos danificados durante transporte',
        },
      });

      await prisma.product.update({
        where: { id: productToAdjust.id },
        data: { currentStock: newStock },
      });

      console.log(`⚙️ Ajuste realizado em ${productToAdjust.name}`);
      console.log(`   Razão: Produtos danificados durante transporte`);
      console.log(`   Quantidade: ${Math.abs(adjustmentQuantity)} unidades`);
      console.log(`   Estoque anterior: ${currentStock}`);
      console.log(`   Estoque novo: ${newStock}`);
    }

    // ==========================================
    // FLUXO 4: Entrada de Estoque Massiva
    // ==========================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 FLUXO 4: ENTRADA DE ESTOQUE MASSIVA');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (products.length > 0 && admin) {
      console.log(`📥 Recebimento de pedido do fornecedor:\n`);

      for (const product of products.slice(0, 3)) {
        const entryQuantity = Math.floor(Math.random() * 50) + 30;
        const currentStock = parseFloat(product.currentStock);
        const newStock = currentStock + entryQuantity;

        await prisma.stockMovement.create({
          data: {
            productId: product.id,
            type: 'ENTRY',
            quantity: entryQuantity,
            previousStock: currentStock,
            newStock,
            userId: admin.id,
            reason: 'Pedido do fornecedor #FN-2026-10-09',
          },
        });

        await prisma.product.update({
          where: { id: product.id },
          data: { currentStock: newStock },
        });

        console.log(`   ✅ ${product.name}`);
        console.log(`      Quantidade recebida: ${entryQuantity}`);
        console.log(`      Estoque: ${currentStock} → ${newStock}`);
      }
    }

    // ==========================================
    // FLUXO 5: Análise de Vendas
    // ==========================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 FLUXO 5: ANÁLISE DE VENDAS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const allSales = await prisma.sale.findMany({
      include: { items: true, seller: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    let totalSalesAmount = 0;
    let totalItemsSold = 0;

    console.log(`📊 Últimas 10 vendas:\n`);

    allSales.forEach((sale, index) => {
      const itemCount = sale.items.length;
      const saleAmount = parseFloat(sale.totalAmount);

      totalSalesAmount += saleAmount;
      totalItemsSold += itemCount;

      console.log(`${index + 1}. Venda #${sale.id.substring(0, 8)}`);
      console.log(`   Vendedor: ${sale.seller.name}`);
      console.log(`   Itens: ${itemCount} | Valor: R$ ${saleAmount.toFixed(2)}`);
      console.log(`   Status: ${sale.canceled ? '❌ Cancelada' : '✅ Concluída'}\n`);
    });

    console.log(`📈 Resumo:`);
    console.log(`   Total de vendas: ${allSales.length}`);
    console.log(`   Itens vendidos: ${totalItemsSold}`);
    console.log(`   Faturamento: R$ ${totalSalesAmount.toFixed(2)}`);
    console.log(`   Ticket médio: R$ ${(totalSalesAmount / (allSales.length || 1)).toFixed(2)}`);

    // ==========================================
    // FLUXO 6: Histórico de Movimentações
    // ==========================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 FLUXO 6: HISTÓRICO DE MOVIMENTAÇÕES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const movements = await prisma.stockMovement.findMany({
      include: { product: true, user: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    const movementsByType = {
      ENTRY: 0,
      SALE: 0,
      ADJUSTMENT: 0,
      LOSS: 0,
    };

    movements.forEach(m => movementsByType[m.type]++);

    console.log(`📋 Últimas 15 movimentações:\n`);

    movements.slice(0, 8).forEach((movement, index) => {
      const typeEmoji = {
        ENTRY: '📥',
        SALE: '💰',
        ADJUSTMENT: '⚙️',
        LOSS: '❌',
      }[movement.type];

      console.log(`${index + 1}. ${typeEmoji} ${movement.type}`);
      console.log(`   Produto: ${movement.product.name}`);
      console.log(`   Quantidade: ${movement.quantity}`);
      console.log(`   Estoque: ${movement.previousStock} → ${movement.newStock}`);
      console.log(`   Usuário: ${movement.user.name}\n`);
    });

    console.log(`📊 Resumo de movimentações:`);
    console.log(`   Entradas (ENTRY): ${movementsByType.ENTRY}`);
    console.log(`   Vendas (SALE): ${movementsByType.SALE}`);
    console.log(`   Ajustes (ADJUSTMENT): ${movementsByType.ADJUSTMENT}`);
    console.log(`   Perdas (LOSS): ${movementsByType.LOSS}`);
    console.log(`   Total: ${movements.length}`);

    // ==========================================
    // FLUXO 7: Produtos Mais Vendidos
    // ==========================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 FLUXO 7: PRODUTOS MAIS VENDIDOS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const topProducts = await prisma.saleItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: 5,
    });

    console.log(`🏆 Top 5 produtos mais vendidos:\n`);

    for (let i = 0; i < topProducts.length; i++) {
      const product = await prisma.product.findUnique({
        where: { id: topProducts[i].productId },
      });

      const totalQuantity = topProducts[i]._sum.quantity;
      const totalRevenue = totalQuantity * parseFloat(product.salePrice);

      console.log(`${i + 1}. ${product.name}`);
      console.log(`   Quantidade vendida: ${totalQuantity} unidades`);
      console.log(`   Faturamento: R$ ${totalRevenue.toFixed(2)}`);
      console.log(`   Preço unitário: R$ ${product.salePrice.toFixed(2)}\n`);
    }

    // ==========================================
    // RESUMO FINAL
    // ==========================================
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ RESUMO FINAL                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const totalProducts = await prisma.product.count();
    const totalSalesCount = await prisma.sale.count();
    const totalMovementsCount = await prisma.stockMovement.count();
    const totalUsersCount = await prisma.user.count();
    const totalRevenue = await prisma.sale.aggregate({
      _sum: { totalAmount: true },
    });

    console.log(`📊 ESTATÍSTICAS DO SISTEMA:\n`);
    console.log(`   📦 Total de produtos: ${totalProducts}`);
    console.log(`   💰 Total de vendas: ${totalSalesCount}`);
    console.log(`   📥 Total de movimentações: ${totalMovementsCount}`);
    console.log(`   👥 Total de usuários: ${totalUsersCount}`);
    console.log(`   💵 Faturamento total: R$ ${(totalRevenue._sum.totalAmount || 0).toFixed(2)}`);

    console.log(`\n🎉 SIMULAÇÃO COMPLETADA COM SUCESSO!\n`);

  } catch (e) {
    console.error('❌ Erro:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
