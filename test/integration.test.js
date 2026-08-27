// Testes de integração de regressão: rodam contra um PostgreSQL real (não
// mocks) e sobem a aplicação de verdade na memória, exatamente como ela
// roda em produção. Protegem especificamente contra os bugs mais graves
// encontrados durante a auditoria de segurança — sem eles, seria fácil uma
// mudança futura reintroduzir silenciosamente qualquer um desses problemas.
//
// Requer uma DATABASE_URL de teste configurada (.env) apontando para um
// PostgreSQL dedicado a testes — a suíte APAGA todos os dados desse banco
// antes de rodar. Nunca aponte para um banco com dados reais.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const { prisma, resetDb } = require('./helpers/db');
const { makeCookieJar, request } = require('./helpers/http');

let server;
let baseUrl;
let adminJar;

before(async () => {
  await resetDb();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const passwordHash = await bcrypt.hash('TesteSenha123!', 12);
  await prisma.user.create({
    data: { name: 'Admin Teste', email: 'admin.test@example.com', passwordHash, role: 'ADMIN' },
  });

  adminJar = makeCookieJar();
  const login = await request(baseUrl, adminJar, '/api/auth/login', {
    method: 'POST',
    body: { email: 'admin.test@example.com', password: 'TesteSenha123!' },
  });
  assert.equal(login.status, 200, 'login do admin de teste deveria funcionar');
});

after(async () => {
  // `server` pode nunca ter sido criado se before() falhou cedo (ex: a
  // trava de segurança do resetDb recusando um banco que não parece ser de
  // teste) — sem esta checagem, o after() lançaria um segundo erro
  // (TypeError) que mascara a mensagem real do problema.
  if (server) await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

test('CSRF: rota que altera estado rejeita requisição sem X-Requested-With', async () => {
  const res = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminJar.header() },
    body: JSON.stringify({ name: 'x', unit: 'UN', costPrice: 1, salePrice: 2 }),
  });
  assert.equal(res.status, 403);
});

test('SQL injection: payload é armazenado como texto literal, nunca executado', async () => {
  const payload = "Teste'; DROP TABLE \"Product\"; --";
  const created = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: payload, unit: 'UN', costPrice: 1, salePrice: 2 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, payload);

  const list = await request(baseUrl, adminJar, '/api/products');
  assert.equal(list.status, 200, 'a tabela Product precisa continuar existindo e consultável');
});

test('validação de calendário rejeita datas impossíveis (30 de fevereiro)', async () => {
  const res = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Data Impossível', unit: 'UN', costPrice: 1, salePrice: 2, expiryDate: '2026-02-30' },
  });
  assert.equal(res.status, 400);
});

test('barreira de overflow numérico rejeita uma venda absurdamente alta', async () => {
  const product = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Caro', unit: 'UN', costPrice: 1, salePrice: 900_000, initialStock: 100_000 },
  });
  assert.equal(product.status, 201);

  const sale = await request(baseUrl, adminJar, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: product.body.id, quantity: 10_000 }] },
  });
  assert.equal(sale.status, 400);
});

test('venda decrementa o estoque corretamente e rejeita venda além do disponível', async () => {
  const product = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Venda Simples', unit: 'UN', costPrice: 1, salePrice: 10, initialStock: 5 },
  });

  const sale = await request(baseUrl, adminJar, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: product.body.id, quantity: 3 }] },
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.body.totalAmount, 30);

  const afterSale = await request(baseUrl, adminJar, `/api/products/${product.body.id}`);
  assert.equal(afterSale.body.currentStock, 2);

  const oversell = await request(baseUrl, adminJar, '/api/sales', {
    method: 'POST',
    body: { items: [{ productId: product.body.id, quantity: 999 }] },
  });
  assert.equal(oversell.status, 409);
});

test('condição de corrida: entradas de estoque simultâneas nunca perdem atualizações', async () => {
  const product = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Race Entradas', unit: 'UN', costPrice: 1, salePrice: 2, initialStock: 0 },
  });

  await Promise.all(
    Array.from({ length: 20 }, () =>
      request(baseUrl, adminJar, '/api/stock/entries', {
        method: 'POST',
        body: { productId: product.body.id, quantity: 1, reason: 'teste de regressão' },
      }),
    ),
  );

  const after1 = await request(baseUrl, adminJar, `/api/products/${product.body.id}`);
  assert.equal(after1.body.currentStock, 20, '20 entradas simultâneas de +1 devem somar exatamente 20');
});

test('condição de corrida: vendas simultâneas nunca vendem além do estoque disponível', async () => {
  const product = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Race Vendas', unit: 'UN', costPrice: 1, salePrice: 2, initialStock: 10 },
  });

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      request(baseUrl, adminJar, '/api/sales', {
        method: 'POST',
        body: { items: [{ productId: product.body.id, quantity: 1 }] },
      }),
    ),
  );

  const successCount = results.filter((r) => r.status === 201).length;
  assert.equal(successCount, 10, 'só 10 das 20 vendas simultâneas podem ter sucesso (estoque inicial de 10)');

  const after1 = await request(baseUrl, adminJar, `/api/products/${product.body.id}`);
  assert.equal(after1.body.currentStock, 0, 'o estoque nunca pode ficar negativo');
});

test('revogação de sessão: usuário desativado perde acesso imediatamente, mesmo com token ainda válido', async () => {
  const created = await request(baseUrl, adminJar, '/api/users', {
    method: 'POST',
    body: { name: 'Caixa Regressão', email: 'caixa.regressao@example.com', password: 'SenhaCaixa123!', role: 'CASHIER' },
  });
  assert.equal(created.status, 201);

  const cashierJar = makeCookieJar();
  const login = await request(baseUrl, cashierJar, '/api/auth/login', {
    method: 'POST',
    body: { email: 'caixa.regressao@example.com', password: 'SenhaCaixa123!' },
  });
  assert.equal(login.status, 200);

  const meBefore = await request(baseUrl, cashierJar, '/api/auth/me');
  assert.equal(meBefore.status, 200);

  await request(baseUrl, adminJar, `/api/users/${created.body.id}`, { method: 'PUT', body: { active: false } });

  const meAfter = await request(baseUrl, cashierJar, '/api/auth/me');
  assert.equal(meAfter.status, 401, 'o mesmo token, agora com a conta desativada, precisa parar de funcionar na hora');
});

test('autorização: funcionário (caixa) é bloqueado de rotas administrativas e nunca vê preço de custo', async () => {
  const created = await request(baseUrl, adminJar, '/api/users', {
    method: 'POST',
    body: { name: 'Caixa Autorização', email: 'caixa.auth@example.com', password: 'SenhaCaixa123!', role: 'CASHIER' },
  });
  assert.equal(created.status, 201);

  const cashierJar = makeCookieJar();
  await request(baseUrl, cashierJar, '/api/auth/login', {
    method: 'POST',
    body: { email: 'caixa.auth@example.com', password: 'SenhaCaixa123!' },
  });

  const usersRes = await request(baseUrl, cashierJar, '/api/users');
  assert.equal(usersRes.status, 403);

  const reportsRes = await request(baseUrl, cashierJar, '/api/reports/forecast');
  assert.equal(reportsRes.status, 403);

  const productsRes = await request(baseUrl, cashierJar, '/api/products');
  assert.equal(productsRes.status, 200);
  for (const p of productsRes.body) {
    assert.equal('costPrice' in p, false, `produto "${p.name}" não deveria expor costPrice para o caixa`);
    assert.equal('margin' in p, false);
  }
});

test('produto desativado pode ser reativado pelo administrador', async () => {
  const product = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Reativação', unit: 'UN', costPrice: 1, salePrice: 2 },
  });

  await request(baseUrl, adminJar, `/api/products/${product.body.id}`, { method: 'DELETE' });
  const deactivated = await request(baseUrl, adminJar, `/api/products/${product.body.id}`);
  assert.equal(deactivated.body.active, false);

  await request(baseUrl, adminJar, `/api/products/${product.body.id}`, { method: 'PUT', body: { active: true } });
  const reactivated = await request(baseUrl, adminJar, `/api/products/${product.body.id}`);
  assert.equal(reactivated.body.active, true);
});

test('produto desativado fica invisível para o caixa na rota de detalhe (não só na listagem)', async () => {
  const product = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Oculto', unit: 'UN', costPrice: 1, salePrice: 2 },
  });
  await request(baseUrl, adminJar, `/api/products/${product.body.id}`, { method: 'DELETE' });

  const cashierJar = makeCookieJar();
  await request(baseUrl, cashierJar, '/api/auth/login', {
    method: 'POST',
    body: { email: 'caixa.auth@example.com', password: 'SenhaCaixa123!' },
  });

  const res = await request(baseUrl, cashierJar, `/api/products/${product.body.id}`);
  assert.equal(res.status, 404);

  // reativa para não deixar lixo para os próximos testes/rodadas manuais
  await request(baseUrl, adminJar, `/api/products/${product.body.id}`, { method: 'PUT', body: { active: true } });
});
