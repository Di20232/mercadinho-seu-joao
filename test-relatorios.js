/**
 * Script manual de validação do relatório de vendas.
 *
 * Uso:
 *   TEST_ADMIN_EMAIL=admin@example.com TEST_ADMIN_PASSWORD="senha" node test-relatorios.js
 */

const assert = require('assert');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_ADMIN_EMAIL = (process.env.TEST_ADMIN_EMAIL || '').toLowerCase().trim();
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || '';
let cookie = '';

async function test() {
  try {
    console.log('\n📋 VALIDAÇÃO - RELATÓRIO DE VENDAS\n');

    if (!TEST_ADMIN_EMAIL || !TEST_ADMIN_PASSWORD) {
      throw new Error('Defina TEST_ADMIN_EMAIL e TEST_ADMIN_PASSWORD para validar relatórios.');
    }

    console.log('1️⃣  Testando login de administrador...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    assert.strictEqual(loginRes.status, 200, `Login falhou: ${loginRes.status}`);

    const loginData = await loginRes.json();
    assert(loginData.id, 'Sem ID de usuário na resposta');
    assert.strictEqual(loginData.role, 'ADMIN', 'Usuário precisa ser ADMIN para acessar relatórios');

    const setCookie = loginRes.headers.get('set-cookie');
    cookie = setCookie ? setCookie.split(';')[0] : '';
    assert(cookie, 'Sem cookie na resposta de login');
    console.log('   ✅ Login ok, usuário:', loginData.name, `(${loginData.email})`);

    console.log('\n2️⃣  Testando /api/reports/sales-summary...');
    const summaryRes = await fetch(`${BASE_URL}/api/reports/sales-summary`, {
      headers: { 'X-Requested-With': 'fetch', Cookie: cookie },
    });
    assert.strictEqual(summaryRes.status, 200, `Sales-summary falhou: ${summaryRes.status}`);
    const summary = await summaryRes.json();
    assert.strictEqual(typeof summary.total, 'number', 'Campo total ausente');
    assert.strictEqual(typeof summary.count, 'number', 'Campo count ausente');
    assert(typeof summary.byDay === 'object', 'Campo byDay ausente');
    console.log(`   ✅ Resumo ok: ${summary.count} vendas, Total: R$ ${summary.total.toFixed(2)}`);
    console.log('   Dias com vendas:', Object.keys(summary.byDay).length);

    console.log('\n3️⃣  Testando /api/reports/top-products...');
    const topRes = await fetch(`${BASE_URL}/api/reports/top-products`, {
      headers: { 'X-Requested-With': 'fetch', Cookie: cookie },
    });
    assert.strictEqual(topRes.status, 200, `Top-products falhou: ${topRes.status}`);
    const topProducts = await topRes.json();
    assert(Array.isArray(topProducts), 'Top products não é array');
    if (topProducts.length > 0) {
      assert(topProducts[0].name, 'Produto sem nome');
      assert(topProducts[0].quantitySold, 'Produto sem quantitySold');
      assert(topProducts[0].revenue, 'Produto sem revenue');
      console.log(`   ✅ Top produtos ok: ${topProducts.length} produtos`);
      console.log(`   #1: ${topProducts[0].name} - ${topProducts[0].quantitySold} unidades, R$ ${topProducts[0].revenue.toFixed(2)}`);
    } else {
      console.log('   ⚠️  Nenhum produto encontrado (sem vendas?)');
    }

    console.log('\n4️⃣  Testando /api/reports/slow-moving...');
    const slowRes = await fetch(`${BASE_URL}/api/reports/slow-moving`, {
      headers: { 'X-Requested-With': 'fetch', Cookie: cookie },
    });
    assert.strictEqual(slowRes.status, 200, `Slow-moving falhou: ${slowRes.status}`);
    const slowMoving = await slowRes.json();
    assert(Array.isArray(slowMoving), 'Slow-moving não é array');
    console.log(`   ✅ Produtos parados ok: ${slowMoving.length} produtos`);
    if (slowMoving.length > 0) {
      console.log(`   #1: ${slowMoving[0].name} - ${slowMoving[0].currentStock} unidades em estoque`);
    }

    console.log('\n5️⃣  Testando filtro de data "to" (inclusão de fim de dia)...');
    const today = new Date().toISOString().slice(0, 10);
    const filteredRes = await fetch(`${BASE_URL}/api/reports/sales-summary?to=${today}`, {
      headers: { 'X-Requested-With': 'fetch', Cookie: cookie },
    });
    assert.strictEqual(filteredRes.status, 200, `Filtro de data falhou: ${filteredRes.status}`);
    const filtered = await filteredRes.json();
    console.log(`   ✅ Filtro ok: ${filtered.count} vendas até ${today} (23:59:59)`);

    console.log('\n✅ TODOS OS TESTES PASSARAM!\n');
  } catch (err) {
    console.error('\n❌ ERRO:', err.message, '\n');
    process.exitCode = 1;
  }
}

test();
