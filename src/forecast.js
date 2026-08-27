const prisma = require('./db');
const config = require('./config');

// Previsão simples: consumo médio diário nos últimos N dias (baseado em
// movimentações de venda) projetado sobre o estoque atual.
async function getStockForecast() {
  const windowDays = config.forecastWindowDays;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [products, sold] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.stockMovement.groupBy({
      by: ['productId'],
      where: { type: 'SALE', createdAt: { gte: since } },
      _sum: { quantity: true },
    }),
  ]);

  const soldMap = new Map(sold.map((s) => [s.productId, Math.abs(Number(s._sum.quantity || 0))]));

  const forecast = products.map((p) => {
    const totalSold = soldMap.get(p.id) || 0;
    const avgDaily = totalSold / windowDays;
    const currentStock = Number(p.currentStock);
    const minStock = Number(p.minStock);
    const daysUntilStockout = avgDaily > 0 ? currentStock / avgDaily : null;

    return {
      productId: p.id,
      name: p.name,
      unit: p.unit,
      currentStock,
      minStock,
      avgDailySales: Number(avgDaily.toFixed(3)),
      daysUntilStockout: daysUntilStockout !== null ? Number(daysUntilStockout.toFixed(1)) : null,
      lowStock: currentStock <= minStock,
    };
  });

  forecast.sort((a, b) => {
    if (a.daysUntilStockout === null && b.daysUntilStockout === null) return 0;
    if (a.daysUntilStockout === null) return 1;
    if (b.daysUntilStockout === null) return -1;
    return a.daysUntilStockout - b.daysUntilStockout;
  });

  return forecast;
}

module.exports = { getStockForecast };
