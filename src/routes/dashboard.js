const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { authenticate } = require('../auth');
const { getStockForecast } = require('../forecast');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const forecast = await getStockForecast();
  const lowStock = forecast.filter((p) => p.lowStock);
  const soonOut = forecast.filter((p) => !p.lowStock && p.daysUntilStockout !== null && p.daysUntilStockout <= 7);

  const expiringUntil = new Date(Date.now() + config.expiryAlertDays * 24 * 60 * 60 * 1000);
  const expiring = await prisma.product.findMany({
    where: { active: true, expiryDate: { not: null, lte: expiringUntil } },
    orderBy: { expiryDate: 'asc' },
    select: { id: true, name: true, expiryDate: true, currentStock: true },
  });

  const payload = {
    lowStock,
    soonOut,
    expiring: expiring.map((p) => ({
      id: p.id,
      name: p.name,
      expiryDate: p.expiryDate,
      currentStock: Number(p.currentStock),
    })),
  };

  // Números financeiros e produtos parados ficam visíveis só para o administrador.
  if (req.user.role === 'ADMIN') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const since60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const [todaySales, monthSales, stockedProducts, recentSales] = await Promise.all([
      prisma.sale.aggregate({ where: { canceled: false, createdAt: { gte: startOfDay } }, _sum: { totalAmount: true }, _count: true }),
      prisma.sale.aggregate({ where: { canceled: false, createdAt: { gte: startOfMonth } }, _sum: { totalAmount: true }, _count: true }),
      prisma.product.findMany({ where: { active: true, currentStock: { gt: 0 } }, select: { id: true, name: true, currentStock: true } }),
      prisma.stockMovement.groupBy({ by: ['productId'], where: { type: 'SALE', createdAt: { gte: since60 } }, _sum: { quantity: true } }),
    ]);

    const soldRecently = new Set(recentSales.map((r) => r.productId));
    const slowMoving = stockedProducts
      .filter((p) => !soldRecently.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, currentStock: Number(p.currentStock) }));

    payload.today = { total: Number(todaySales._sum.totalAmount || 0), count: todaySales._count };
    payload.month = { total: Number(monthSales._sum.totalAmount || 0), count: monthSales._count };
    payload.slowMoving = slowMoving;
  }

  res.json(payload);
});

module.exports = router;
