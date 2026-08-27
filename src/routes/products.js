const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const validate = require('../validate');
const httpError = require('../httpError');
const { authenticate, authorize } = require('../auth');

const router = express.Router();
router.use(authenticate);

// O regex garante o formato; o refine garante que a data existe de fato no
// calendário. Não basta checar se `Date.parse` retorna um valor válido: o
// parser de datas do JavaScript "conserta" silenciosamente dias fora do mês
// (ex: "2026-02-30" vira 2 de março) em vez de rejeitar — então validamos
// comparando os componentes de volta após a conversão (round-trip).
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).')
  .refine((v) => {
    const [year, month, day] = v.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Essa data não existe no calendário.');
const money = z.number().finite().nonnegative().max(1_000_000);

const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  barcode: z.string().trim().max(64).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  unit: z.string().trim().min(1).max(10).default('UN'),
  costPrice: money,
  salePrice: z.number().finite().positive().max(1_000_000),
  minStock: z.number().finite().nonnegative().max(1_000_000).default(0),
  initialStock: z.number().finite().nonnegative().max(1_000_000).default(0),
  expiryDate: dateOnly.optional().nullable(),
});

// `active` só entra no schema de atualização (nunca no de criação — todo
// produto nasce ativo). Sem isso, uma vez desativado (DELETE /products/:id),
// não existia NENHUMA forma de reativar um produto — nem pela API, nem pela
// tela — a não ser mexendo direto no banco de dados.
const productUpdateSchema = productCreateSchema.partial().omit({ initialStock: true }).extend({ active: z.boolean().optional() });

function serializeProduct(p, role) {
  const base = {
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    category: p.category,
    unit: p.unit,
    salePrice: Number(p.salePrice),
    currentStock: Number(p.currentStock),
    minStock: Number(p.minStock),
    expiryDate: p.expiryDate,
    active: p.active,
  };
  if (role === 'ADMIN') {
    base.costPrice = Number(p.costPrice);
    base.margin = Number(p.salePrice) - Number(p.costPrice);
  }
  return base;
}

router.get('/', async (req, res) => {
  const { query, category, lowStock, includeInactive } = req.query;
  const where = {};
  if (!(includeInactive === 'true' && req.user.role === 'ADMIN')) where.active = true;
  if (query) where.name = { contains: String(query), mode: 'insensitive' };
  if (category) where.category = String(category);

  const products = await prisma.product.findMany({ where, orderBy: { name: 'asc' } });
  let result = products.map((p) => serializeProduct(p, req.user.role));
  if (lowStock === 'true') result = result.filter((p) => p.currentStock <= p.minStock);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const p = await prisma.product.findUnique({ where: { id: req.params.id } });
  // A listagem (GET /) já esconde produtos desativados de quem não é admin;
  // sem esta mesma checagem aqui, bastava saber (ou adivinhar) o ID de um
  // produto descontinuado para um funcionário ver seus detalhes completos
  // por fora da tela normal — a rota de detalhe precisa impor a mesma regra.
  if (!p || (!p.active && req.user.role !== 'ADMIN')) throw httpError(404, 'Produto não encontrado.');
  res.json(serializeProduct(p, req.user.role));
});

router.post('/', authorize('ADMIN'), validate(productCreateSchema), async (req, res) => {
  const data = req.body;

  if (data.barcode) {
    const dup = await prisma.product.findUnique({ where: { barcode: data.barcode } });
    if (dup) throw httpError(409, 'Já existe um produto com este código de barras.');
  }

  let product;
  try {
    product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: data.name,
          barcode: data.barcode || null,
          category: data.category || null,
          unit: data.unit,
          costPrice: data.costPrice.toFixed(2),
          salePrice: data.salePrice.toFixed(2),
          minStock: data.minStock.toFixed(3),
          currentStock: data.initialStock.toFixed(3),
          expiryDate: data.expiryDate ? new Date(`${data.expiryDate}T00:00:00Z`) : null,
        },
      });

      if (data.initialStock > 0) {
        await tx.stockMovement.create({
          data: {
            productId: created.id,
            type: 'ENTRY',
            quantity: data.initialStock.toFixed(3),
            previousStock: '0',
            newStock: data.initialStock.toFixed(3),
            reason: 'Estoque inicial no cadastro',
            userId: req.user.sub,
          },
        });
      }

      return created;
    });
  } catch (err) {
    // P2002 = violação de restrição única (ex: duas requisições simultâneas com o mesmo código de barras)
    if (err.code === 'P2002') throw httpError(409, 'Já existe um produto com este código de barras.');
    throw err;
  }

  res.status(201).json(serializeProduct(product, req.user.role));
});

router.put('/:id', authorize('ADMIN'), validate(productUpdateSchema), async (req, res) => {
  const data = req.body;
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) throw httpError(404, 'Produto não encontrado.');

  if (data.barcode && data.barcode !== existing.barcode) {
    const dup = await prisma.product.findUnique({ where: { barcode: data.barcode } });
    if (dup) throw httpError(409, 'Já existe um produto com este código de barras.');
  }

  let product;
  try {
    product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.barcode !== undefined && { barcode: data.barcode || null }),
        ...(data.category !== undefined && { category: data.category || null }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.costPrice !== undefined && { costPrice: data.costPrice.toFixed(2) }),
        ...(data.salePrice !== undefined && { salePrice: data.salePrice.toFixed(2) }),
        ...(data.minStock !== undefined && { minStock: data.minStock.toFixed(3) }),
        ...(data.expiryDate !== undefined && {
          expiryDate: data.expiryDate ? new Date(`${data.expiryDate}T00:00:00Z`) : null,
        }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') throw httpError(409, 'Já existe um produto com este código de barras.');
    throw err;
  }

  res.json(serializeProduct(product, req.user.role));
});

// Exclusão lógica: preserva o histórico de vendas/movimentações já vinculado ao produto.
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) throw httpError(404, 'Produto não encontrado.');
  await prisma.product.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
});

module.exports = router;
