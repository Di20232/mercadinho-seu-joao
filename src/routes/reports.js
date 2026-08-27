const express = require('express');
const prisma = require('../db');
const { authenticate, authorize } = require('../auth');
const { getStockForecast } = require('../forecast');
const { parseDateParam, clampIntParam } = require('../queryHelpers');

const router = express.Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/forecast', async (req, res) => {
  res.json(await getStockForecast());
});

router.get('/sales-summary', async (req, res) => {
  const from = parseDateParam(req.query.from, 'from');
  const to = parseDateParam(req.query.to, 'to');
  const where = { canceled: false };
  if (from || to) where.createdAt = {};
  if (from) where.createdAt.gte = from;
  if (to) where.createdAt.lte = to;

  const sales = await prisma.sale.findMany({ where, select: { totalAmount: true, createdAt: true } });

  const byDay = {};
  let total = 0;
  for (const s of sales) {
    const day = s.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + Number(s.totalAmount);
    total += Number(s.totalAmount);
  }

  res.json({ total, count: sales.length, byDay });
});

router.get('/top-products', async (req, res) => {
  const from = parseDateParam(req.query.from, 'from');
  const to = parseDateParam(req.query.to, 'to');
  const limit = clampIntParam(req.query.limit, { min: 1, max: 50, fallback: 10 });

  const saleWhere = { canceled: false };
  if (from || to) saleWhere.createdAt = {};
  if (from) saleWhere.createdAt.gte = from;
  if (to) saleWhere.createdAt.lte = to;

  const items = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleWhere },
    _sum: { quantity: true, subtotal: true },
    orderBy: { _sum: { subtotal: 'desc' } },
    take: limit,
  });

  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const nameById = new Map(products.map((p) => [p.id, p.name]));

  res.json(
    items.map((i) => ({
      productId: i.productId,
      name: nameById.get(i.productId) || 'Produto removido',
      quantitySold: Number(i._sum.quantity),
      revenue: Number(i._sum.subtotal),
    })),
  );
});

router.get('/slow-moving', async (req, res) => {
  const days = clampIntParam(req.query.days, { min: 1, max: 365, fallback: 60 });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [stockedProducts, recentSales] = await Promise.all([
    prisma.product.findMany({ where: { active: true, currentStock: { gt: 0 } }, select: { id: true, name: true, currentStock: true, costPrice: true } }),
    prisma.stockMovement.groupBy({ by: ['productId'], where: { type: 'SALE', createdAt: { gte: since } }, _sum: { quantity: true } }),
  ]);

  const soldRecently = new Set(recentSales.map((r) => r.productId));
  const slowMoving = stockedProducts
    .filter((p) => !soldRecently.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      currentStock: Number(p.currentStock),
      capitalParado: Number((Number(p.currentStock) * Number(p.costPrice)).toFixed(2)),
    }));

  res.json(slowMoving);
});

module.exports = router;
