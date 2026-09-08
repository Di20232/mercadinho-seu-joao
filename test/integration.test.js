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

// ---------- Importação de planilha ----------

const IMPORT_HEADERS = ['Nome', 'Código de Barras', 'Categoria', 'Unidade', 'Preço de Custo', 'Preço de Venda', 'Estoque', 'Estoque Mínimo', 'Validade'];
const IMPORT_MAPPING = { name: 0, barcode: 1, category: 2, unit: 3, costPrice: 4, salePrice: 5, stock: 6, minStock: 7, expiryDate: 8 };

function importBody(rows, options = {}) {
  return {
    headers: IMPORT_HEADERS,
    rows,
    mapping: IMPORT_MAPPING,
    options: { mode: 'upsert', matchBy: 'barcode', stockMode: 'ignore', ...options },
  };
}

test('importação: caixa é bloqueado em todas as rotas de importação', async () => {
  const cashierJar = makeCookieJar();
  await request(baseUrl, cashierJar, '/api/auth/login', {
    method: 'POST',
    body: { email: 'caixa.auth@example.com', password: 'SenhaCaixa123!' },
  });

  const template = await request(baseUrl, cashierJar, '/api/imports/products/template');
  assert.equal(template.status, 403);

  const parse = await request(baseUrl, cashierJar, '/api/imports/products/parse', { method: 'POST', body: { text: 'Nome\nX' } });
  assert.equal(parse.status, 403);

  const commit = await request(baseUrl, cashierJar, '/api/imports/products/commit', { method: 'POST', body: importBody([]) });
  assert.equal(commit.status, 403, 'gravar produtos em massa nunca pode ficar disponível para o caixa');
});

test('importação: números em formato brasileiro e datas dd/mm/aaaa são gravados corretamente', async () => {
  const commit = await request(baseUrl, adminJar, '/api/imports/products/commit', {
    method: 'POST',
    body: importBody([['Produto Importado BR', '7890000000101', 'Mercearia', 'cx', 'R$ 1.234,56', '2.499,90', '12,5', '3', '31/12/2027']]),
  });
  assert.equal(commit.status, 200);
  assert.equal(commit.body.created, 1);

  const list = await request(baseUrl, adminJar, '/api/products?query=Produto Importado BR');
  const product = list.body[0];
  assert.equal(product.costPrice, 1234.56, '"R$ 1.234,56" precisa virar 1234.56, não 1.23456');
  assert.equal(product.salePrice, 2499.9);
  assert.equal(product.currentStock, 12.5);
  assert.equal(product.unit, 'CX');
  assert.equal(product.expiryDate.slice(0, 10), '2027-12-31');
});

test('importação: acerto de saldo registra movimentação com o estoque anterior e o novo', async () => {
  const created = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Import Saldo', barcode: '7890000000102', unit: 'UN', costPrice: 1, salePrice: 5, initialStock: 10 },
  });
  assert.equal(created.status, 201);

  const commit = await request(baseUrl, adminJar, '/api/imports/products/commit', {
    method: 'POST',
    body: importBody([['Produto Import Saldo', '7890000000102', 'Mercearia', 'UN', '1,00', '5,00', '25', '0', '']], { stockMode: 'set' }),
  });
  assert.equal(commit.body.updated, 1);

  const after = await request(baseUrl, adminJar, `/api/products/${created.body.id}`);
  assert.equal(after.body.currentStock, 25);

  const movements = await request(baseUrl, adminJar, `/api/stock/movements?productId=${created.body.id}`);
  const adjustment = movements.body.find((m) => m.type === 'ADJUSTMENT');
  assert.ok(adjustment, 'o acerto de saldo por importação precisa deixar rastro no extrato de movimentações');
  assert.equal(adjustment.quantity, 15);
  assert.equal(adjustment.previousStock, 10);
  assert.equal(adjustment.newStock, 25, 'saldo anterior e novo precisam bater com o estoque real — é o que torna o extrato auditável');
});

test('importação: código de barras repetido no arquivo não cadastra o produto duas vezes', async () => {
  const rows = [
    ['Produto Import Duplicado', '7890000000103', 'Mercearia', 'UN', '2,00', '4,00', '10', '1', ''],
    ['Produto Import Duplicado', '7890000000103', 'Mercearia', 'UN', '2,00', '4,00', '10', '1', ''],
  ];

  const preview = await request(baseUrl, adminJar, '/api/imports/products/preview', { method: 'POST', body: importBody(rows) });
  assert.equal(preview.body.summary.create, 1);
  assert.equal(preview.body.summary.error, 1, 'a segunda linha com o mesmo código de barras precisa ser barrada na conferência');

  const commit = await request(baseUrl, adminJar, '/api/imports/products/commit', { method: 'POST', body: importBody(rows) });
  assert.equal(commit.body.created, 1);

  const list = await request(baseUrl, adminJar, '/api/products?query=Produto Import Duplicado&includeInactive=true');
  assert.equal(list.body.length, 1, 'a planilha com a linha repetida nunca pode gerar dois cadastros do mesmo produto');
});

test('importação: código de barras que pertence a outro produto é recusado, nunca sobrescrito', async () => {
  await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'Produto Import Dono do Código', barcode: '7890000000104', unit: 'UN', costPrice: 1, salePrice: 2 },
  });

  // Mesmo código de barras, outro nome: casar por nome criaria um produto novo
  // com um código já usado (violação de unicidade) ou roubaria o código do dono.
  const rows = [['Produto Import Invasor', '7890000000104', 'Mercearia', 'UN', '1,00', '3,00', '5', '1', '']];
  const preview = await request(baseUrl, adminJar, '/api/imports/products/preview', {
    method: 'POST',
    body: importBody(rows, { matchBy: 'name' }),
  });
  assert.equal(preview.body.summary.error, 1);

  const commit = await request(baseUrl, adminJar, '/api/imports/products/commit', {
    method: 'POST',
    body: importBody(rows, { matchBy: 'name' }),
  });
  assert.equal(commit.body.created, 0);
  assert.equal(commit.body.updated, 0);

  const owner = await request(baseUrl, adminJar, '/api/products?query=Produto Import Dono do Código');
  assert.equal(owner.body[0].barcode, '7890000000104', 'o dono do código de barras não pode perdê-lo para outra linha da planilha');
});

test('importação: aceita corpo grande, mas as demais rotas continuam limitadas a 100kb', async () => {
  // A grade da planilha volta ao servidor a cada conferência, então só a
  // importação tem limite ampliado. Se um dia o parser JSON global voltar a
  // valer para /api/imports, este teste falha antes de o usuário descobrir
  // sozinho que planilhas médias param de abrir.
  const padding = 'Produto Volume '.padEnd(90, 'x');
  const rows = Array.from({ length: 800 }, (_, i) => [`${padding}${i}`, '', 'Mercearia', 'UN', '1,00', '2,00', '1', '0', '']);
  const body = importBody(rows, { mode: 'updateOnly' });
  assert.ok(JSON.stringify(body).length > 100 * 1024, 'o payload de teste precisa passar de 100kb para o teste fazer sentido');

  const preview = await request(baseUrl, adminJar, '/api/imports/products/preview', { method: 'POST', body });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.summary.skip, 800);

  const oversized = await request(baseUrl, adminJar, '/api/products', {
    method: 'POST',
    body: { name: 'x'.repeat(120 * 1024), unit: 'UN', costPrice: 1, salePrice: 2 },
  });
  assert.equal(oversized.status, 413, 'as rotas normais precisam continuar recusando corpos gigantes');
});

test('importação: planilha .xlsx é lida e as colunas são reconhecidas pelo cabeçalho', async () => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lista');
  // Cabeçalhos com nomes diferentes dos do modelo: é o reconhecimento por
  // sinônimo que faz a planilha do fornecedor funcionar sem edição manual.
  sheet.addRow(['DESCRICAO', 'EAN', 'VLR VENDA', 'QTDE', 'VENCIMENTO']);
  sheet.addRow(['Produto Import Xlsx', 7890000000105, 9.9, 7, new Date(Date.UTC(2027, 4, 20))]);
  const buffer = await workbook.xlsx.writeBuffer();

  const form = new FormData();
  form.append('file', new Blob([buffer]), 'fornecedor.xlsx');
  const res = await fetch(`${baseUrl}/api/imports/products/parse`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch', Cookie: adminJar.header() },
    body: form,
  });
  assert.equal(res.status, 200);

  const parsed = await res.json();
  assert.deepEqual(parsed.mapping, { name: 0, barcode: 1, salePrice: 2, stock: 3, expiryDate: 4 });

  const commit = await request(baseUrl, adminJar, '/api/imports/products/commit', {
    method: 'POST',
    body: { headers: parsed.headers, rows: parsed.rows, mapping: parsed.mapping, options: { mode: 'upsert', matchBy: 'barcode', stockMode: 'ignore' } },
  });
  assert.equal(commit.body.created, 1);

  const list = await request(baseUrl, adminJar, '/api/products?query=Produto Import Xlsx');
  assert.equal(list.body[0].salePrice, 9.9);
  assert.equal(list.body[0].currentStock, 7);
  assert.equal(list.body[0].expiryDate.slice(0, 10), '2027-05-20', 'a data do Excel (número de série) precisa virar a mesma data no banco');
});
