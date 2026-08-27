const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const validate = require('../validate');
const { authenticate, authorize } = require('../auth');
const { parseDateParam, parseEnumParam } = require('../queryHelpers');
const { applyStockDelta } = require('../stockOps');

const router = express.Router();
// Movimentações de estoque (entradas de compra e ajustes/perdas) são
// exclusivas do dono/administrador, para manter um único responsável pelos números.
router.use(authenticate, authorize('ADMIN'));

const entrySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().finite().positive().max(1_000_000),
  reason: z.string().trim().max(255).optional().nullable(),
});

const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  quantity: z
    .number()
    .finite()
    .refine((v) => v !== 0, 'A quantidade não pode ser zero.')
    .refine((v) => Math.abs(v) <= 1_000_000),
  reason: z.string().trim().min(1).max(255),
  type: z.enum(['ADJUSTMENT', 'LOSS']).default('ADJUSTMENT'),
});

router.post('/entries', validate(entrySchema), async (req, res) => {
  const { productId, quantity, reason } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const { updated, previousStock, newStock } = await applyStockDelta(tx, productId, quantity);
    await tx.stockMovement.create({
      data: {
        productId,
        type: 'ENTRY',
        quantity: quantity.toFixed(3),
        previousStock,
        newStock,
        reason: reason || 'Entrada de estoque (compra)',
        userId: req.user.sub,
      },
    });
    return updated;
  });

  res.status(201).json({ productId: result.id, currentStock: Number(result.currentStock) });
});

router.post('/adjustments', validate(adjustmentSchema), async (req, res) => {
  const { productId, quantity, reason, type } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const { updated, previousStock, newStock } = await applyStockDelta(tx, productId, quantity);
    await tx.stockMovement.create({
      data: {
        productId,
        type,
        quantity: quantity.toFixed(3),
        previousStock,
        newStock,
        reason,
        userId: req.user.sub,
      },
    });
    return updated;
  });

  res.status(201).json({ productId: result.id, currentStock: Number(result.currentStock) });
});

const MOVEMENT_TYPES = ['ENTRY', 'SALE', 'ADJUSTMENT', 'LOSS'];

router.get('/movements', async (req, res) => {
  const { productId } = req.query;
  const type = parseEnumParam(req.query.type, MOVEMENT_TYPES, 'type');
  const from = parseDateParam(req.query.from, 'from');
  const to = parseDateParam(req.query.to, 'to');

  const where = {};
  if (productId) where.productId = String(productId);
  if (type) where.type = type;
  if (from || to) where.createdAt = {};
  if (from) where.createdAt.gte = from;
  if (to) where.createdAt.lte = to;

  const movements = await prisma.stockMovement.findMany({
    where,
    include: { product: { select: { name: true } }, user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  res.json(
    movements.map((m) => ({
      id: m.id,
      product: m.product.name,
      type: m.type,
      quantity: Number(m.quantity),
      previousStock: Number(m.previousStock),
      newStock: Number(m.newStock),
      reason: m.reason,
      user: m.user.name,
      createdAt: m.createdAt,
    })),
  );
});

module.exports = router;
