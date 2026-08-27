let currentUser = null;
let cart = []; // { productId, name, unit, price, quantity }

const content = document.getElementById('content');

function activeTemplate(name) {
  const tpl = document.getElementById(`tpl-${name}`);
  content.innerHTML = '';
  content.appendChild(tpl.content.cloneNode(true));
}

// Abre um <template> como um modal sobreposto (fundo escurecido + card
// centralizado), em vez de anexado ao final do conteúdo da aba. Sem isso, o
// formulário de editar produto/usuário aparecia depois de toda a lista —
// numa tela com muitos produtos, era preciso rolar a página inteira até o
// fim para achar o formulário que acabou de abrir.
function openModal(templateId) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const tpl = document.getElementById(templateId);
  backdrop.appendChild(tpl.content.cloneNode(true));
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const onKeydown = (e) => {
    if (e.key === 'Escape') closeModal(backdrop);
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal(backdrop);
  });
  document.addEventListener('keydown', onKeydown);
  backdrop._onKeydown = onKeydown;

  return backdrop;
}

function closeModal(backdrop) {
  if (!backdrop) return;
  if (backdrop._onKeydown) document.removeEventListener('keydown', backdrop._onKeydown);
  backdrop.remove();
  document.body.style.overflow = '';
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  const renderers = {
    dashboard: renderDashboard,
    vendas: renderVendas,
    produtos: renderProdutos,
    estoque: renderEstoque,
    relatorios: renderRelatorios,
    usuarios: renderUsuarios,
  };
  (renderers[name] || renderDashboard)();
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/auth/logout');
  location.href = '/index.html';
});

// ---------- Boot ----------
(async () => {
  try {
    currentUser = await api.get('/auth/me');
  } catch {
    location.href = '/index.html';
    return;
  }
  document.getElementById('user-name').textContent = `${currentUser.name} (${currentUser.role === 'ADMIN' ? 'admin' : 'caixa'})`;
  document.getElementById('user-avatar').textContent = currentUser.name.trim().charAt(0).toUpperCase();
  document.body.classList.toggle('role-admin', currentUser.role === 'ADMIN');
  switchTab('dashboard');
})();

// ---------- Dashboard ----------
async function renderDashboard() {
  activeTemplate('dashboard');
  const data = await api.get('/dashboard');

  const tbLow = document.getElementById('tb-low-stock');
  data.lowStock.forEach((p) => {
    tbLow.appendChild(el('tr', {}, [
      el('td', {}, p.name),
      el('td', {}, `${p.currentStock} ${p.unit}`),
      el('td', {}, String(p.minStock)),
    ]));
  });
  if (data.lowStock.length === 0) tbLow.appendChild(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'Nenhum produto abaixo do mínimo.')));

  const tbSoon = document.getElementById('tb-soon-out');
  data.soonOut.forEach((p) => {
    tbSoon.appendChild(el('tr', {}, [
      el('td', {}, p.name),
      el('td', {}, `${p.currentStock} ${p.unit}`),
      el('td', {}, `${p.daysUntilStockout} dia(s)`),
    ]));
  });
  if (data.soonOut.length === 0) tbSoon.appendChild(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'Nenhuma previsão de falta em 7 dias.')));

  const tbExp = document.getElementById('tb-expiring');
  data.expiring.forEach((p) => {
    tbExp.appendChild(el('tr', {}, [
      el('td', {}, p.name),
      el('td', {}, formatDate(p.expiryDate)),
      el('td', {}, String(p.currentStock)),
    ]));
  });
  if (data.expiring.length === 0) tbExp.appendChild(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'Nenhum produto vencendo em breve.')));

  if (currentUser.role === 'ADMIN') {
    document.getElementById('admin-summary').hidden = false;
    document.getElementById('stat-today').textContent = `${formatMoney(data.today.total)} (${data.today.count})`;
    document.getElementById('stat-month').textContent = `${formatMoney(data.month.total)} (${data.month.count})`;

    const slowCard = document.getElementById('card-slow-moving');
    slowCard.hidden = false;
    const tbSlow = document.getElementById('tb-slow-moving');
    data.slowMoving.forEach((p) => {
      tbSlow.appendChild(el('tr', {}, [el('td', {}, p.name), el('td', {}, String(p.currentStock))]));
    });
    if (data.slowMoving.length === 0) tbSlow.appendChild(el('tr', {}, el('td', { colspan: '2', class: 'muted' }, 'Nenhum produto parado.')));
  }
}

// ---------- Vendas ----------
async function renderVendas() {
  activeTemplate('vendas');
  cart = [];
  renderCart();

  const searchInput = document.getElementById('sale-search');
  const resultsBox = document.getElementById('sale-results');
  let searchTimer = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const term = searchInput.value.trim();
    if (!term) { resultsBox.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const products = await api.get(`/products?query=${encodeURIComponent(term)}`);
      resultsBox.innerHTML = '';
      products.slice(0, 8).forEach((p) => {
        resultsBox.appendChild(el('div', {
          onclick: () => {
            addToCart(p);
            searchInput.value = '';
            resultsBox.innerHTML = '';
            searchInput.focus();
          },
        }, `${p.name} — ${formatMoney(p.salePrice)} (estoque: ${p.currentStock} ${p.unit})`));
      });
      if (products.length === 0) resultsBox.appendChild(el('div', { class: 'muted' }, 'Nenhum produto encontrado.'));
    }, 250);
  });

  document.getElementById('confirm-sale-btn').addEventListener('click', confirmSale);

  await loadRecentSales();
}

function addToCart(product) {
  const existing = cart.find((i) => i.productId === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ productId: product.id, name: product.name, unit: product.unit, price: product.salePrice, quantity: 1 });
  }
  renderCart();
}

function updateCartTotal() {
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  document.getElementById('cart-total').textContent = formatMoney(total);
}

function renderCart() {
  const body = document.getElementById('cart-body');
  if (!body) return;
  body.innerHTML = '';

  cart.forEach((item, index) => {
    // A célula de subtotal é atualizada diretamente pelo "oninput" abaixo,
    // em vez de chamar renderCart() de novo a cada tecla digitada — recriar
    // a <tr>/<input> em todo keystroke troca o nó DOM do campo de
    // quantidade, e o navegador perde o foco nele. Na prática, o segundo
    // dígito de "12" nunca chegava a ser digitado: o campo perdia o foco
    // assim que o "1" era digitado.
    const subtotalCell = el('td', {}, formatMoney(item.price * item.quantity));
    const qtyInput = el('input', {
      type: 'number', min: '0.001', step: '0.001', value: String(item.quantity),
      oninput: (e) => {
        const v = parseFloat(e.target.value);
        item.quantity = Number.isFinite(v) && v > 0 ? v : item.quantity;
        subtotalCell.textContent = formatMoney(item.price * item.quantity);
        updateCartTotal();
      },
    });
    body.appendChild(el('tr', {}, [
      el('td', {}, item.name),
      el('td', {}, qtyInput),
      el('td', {}, formatMoney(item.price)),
      subtotalCell,
      el('td', {}, el('button', { class: 'small secondary', type: 'button', onclick: () => { cart.splice(index, 1); renderCart(); } }, 'Remover')),
    ]));
  });

  updateCartTotal();
  document.getElementById('confirm-sale-btn').disabled = cart.length === 0;
}

async function confirmSale() {
  const msg = document.getElementById('sale-msg');
  msg.hidden = true;
  const btn = document.getElementById('confirm-sale-btn');
  btn.disabled = true;
  try {
    await api.post('/sales', { items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })) });
    cart = [];
    renderCart();
    await loadRecentSales();
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  } finally {
    btn.disabled = cart.length === 0;
  }
}

async function loadRecentSales() {
  const data = await api.get('/sales?pageSize=15');
  const body = document.getElementById('sales-list');
  body.innerHTML = '';
  data.sales.forEach((s) => {
    const cells = [
      el('td', {}, formatDateTime(s.createdAt)),
      el('td', {}, s.seller),
      el('td', {}, String(s.itemCount)),
      el('td', {}, formatMoney(s.totalAmount)),
    ];
    if (currentUser.role === 'ADMIN') {
      cells.push(el('td', {}, el('button', {
        class: 'small danger', type: 'button',
        onclick: async () => {
          if (!confirm('Cancelar esta venda? O estoque dos itens será devolvido.')) return;
          await api.post(`/sales/${s.id}/cancel`);
          await loadRecentSales();
        },
      }, 'Cancelar')));
    } else {
      cells.push(el('td', {}));
    }
    body.appendChild(el('tr', {}, cells));
  });
  if (data.sales.length === 0) body.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'muted' }, 'Nenhuma venda registrada.')));
}

// ---------- Produtos ----------
async function renderProdutos() {
  activeTemplate('produtos');
  await loadProducts();

  document.getElementById('product-search').addEventListener('input', debounce(loadProducts, 250));
  const newBtn = document.getElementById('new-product-btn');
  if (newBtn) newBtn.addEventListener('click', () => openProductForm(null));
}

async function loadProducts() {
  const term = document.getElementById('product-search')?.value.trim() || '';
  const includeInactive = currentUser.role === 'ADMIN' ? '&includeInactive=true' : '';
  const products = await api.get(`/products?query=${encodeURIComponent(term)}${includeInactive}`);
  const body = document.getElementById('products-list');
  body.innerHTML = '';

  products.forEach((p) => {
    const stockBadge = p.currentStock <= p.minStock
      ? el('span', { class: 'badge bad' }, `${p.currentStock} ${p.unit}`)
      : el('span', {}, `${p.currentStock} ${p.unit}`);

    const cells = [
      el('td', {}, p.name + (p.active ? '' : ' (inativo)')),
      el('td', {}, p.category || '—'),
      el('td', {}, stockBadge),
      el('td', {}, String(p.minStock)),
      el('td', {}, formatMoney(p.salePrice)),
    ];
    const costCell = el('td', {}, currentUser.role === 'ADMIN' ? formatMoney(p.costPrice) : '');
    costCell.setAttribute('data-admin-only', '');
    cells.push(costCell);
    cells.push(el('td', {}, formatDate(p.expiryDate)));

    if (currentUser.role === 'ADMIN') {
      cells.push(el('td', {}, el('button', { class: 'small secondary', type: 'button', onclick: () => openProductForm(p) }, 'Editar')));
    } else {
      cells.push(el('td', {}));
    }
    body.appendChild(el('tr', {}, cells));
  });

  if (products.length === 0) body.appendChild(el('tr', {}, el('td', { colspan: '8', class: 'muted' }, 'Nenhum produto encontrado.')));
}

function openProductForm(product) {
  const modal = openModal('tpl-product-form');

  const isEdit = Boolean(product);
  document.getElementById('product-form-title').textContent = isEdit ? 'Editar produto' : 'Novo produto';
  document.getElementById('p-initial-stock-label').style.display = isEdit ? 'none' : '';
  document.getElementById('p-initial-stock').style.display = isEdit ? 'none' : '';

  if (isEdit) {
    document.getElementById('p-id').value = product.id;
    document.getElementById('p-name').value = product.name;
    document.getElementById('p-category').value = product.category || '';
    document.getElementById('p-barcode').value = product.barcode || '';
    document.getElementById('p-unit').value = product.unit;
    document.getElementById('p-sale-price').value = product.salePrice;
    document.getElementById('p-cost-price').value = product.costPrice ?? '';
    document.getElementById('p-min-stock').value = product.minStock;
    document.getElementById('p-expiry').value = product.expiryDate ? product.expiryDate.slice(0, 10) : '';
    const deleteBtn = document.getElementById('product-delete-btn');
    deleteBtn.hidden = false;
    if (product.active) {
      deleteBtn.textContent = 'Desativar produto';
      deleteBtn.classList.add('danger');
      deleteBtn.classList.remove('secondary');
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Desativar "${product.name}"? Ele deixará de aparecer em vendas novas.`)) return;
        await api.del(`/products/${product.id}`);
        closeModal(modal);
        await loadProducts();
      });
    } else {
      // Sem isto, um produto desativado não tinha NENHUMA forma de voltar —
      // nem pela tela, nem pela API — a não ser mexendo direto no banco.
      deleteBtn.textContent = 'Reativar produto';
      deleteBtn.classList.add('secondary');
      deleteBtn.classList.remove('danger');
      deleteBtn.addEventListener('click', async () => {
        await api.put(`/products/${product.id}`, { active: true });
        closeModal(modal);
        await loadProducts();
      });
    }
  }

  document.getElementById('product-cancel-btn').addEventListener('click', () => closeModal(modal));

  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('product-form-msg');
    msg.hidden = true;
    const payload = {
      name: document.getElementById('p-name').value,
      category: document.getElementById('p-category').value || null,
      barcode: document.getElementById('p-barcode').value || null,
      unit: document.getElementById('p-unit').value,
      salePrice: parseFloat(document.getElementById('p-sale-price').value),
      costPrice: parseFloat(document.getElementById('p-cost-price').value),
      minStock: parseFloat(document.getElementById('p-min-stock').value || '0'),
      expiryDate: document.getElementById('p-expiry').value || null,
    };
    if (!isEdit) payload.initialStock = parseFloat(document.getElementById('p-initial-stock').value || '0');

    try {
      if (isEdit) await api.put(`/products/${product.id}`, payload);
      else await api.post('/products', payload);
      closeModal(modal);
      await loadProducts();
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
}

// ---------- Estoque ----------
async function renderEstoque() {
  activeTemplate('estoque');
  const products = await api.get('/products');

  const entrySelect = document.getElementById('entry-product');
  const adjSelect = document.getElementById('adjustment-product');
  products.forEach((p) => {
    entrySelect.appendChild(el('option', { value: p.id }, `${p.name} (${p.currentStock} ${p.unit})`));
    adjSelect.appendChild(el('option', { value: p.id }, `${p.name} (${p.currentStock} ${p.unit})`));
  });

  document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('entry-msg');
    msg.hidden = true;
    try {
      await api.post('/stock/entries', {
        productId: entrySelect.value,
        quantity: parseFloat(document.getElementById('entry-qty').value),
        reason: document.getElementById('entry-reason').value || undefined,
      });
      document.getElementById('entry-form').reset();
      await renderEstoque();
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });

  document.getElementById('adjustment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('adjustment-msg');
    msg.hidden = true;
    try {
      await api.post('/stock/adjustments', {
        productId: adjSelect.value,
        quantity: -Math.abs(parseFloat(document.getElementById('adjustment-qty').value)),
        reason: document.getElementById('adjustment-reason').value,
        type: 'LOSS',
      });
      document.getElementById('adjustment-form').reset();
      await renderEstoque();
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });

  const movements = await api.get('/stock/movements');
  const body = document.getElementById('movements-list');
  movements.forEach((m) => {
    body.appendChild(el('tr', {}, [
      el('td', {}, formatDateTime(m.createdAt)),
      el('td', {}, m.product),
      el('td', {}, m.type),
      el('td', {}, String(m.quantity)),
      el('td', {}, String(m.newStock)),
      el('td', {}, m.reason || '—'),
      el('td', {}, m.user),
    ]));
  });
  if (movements.length === 0) body.appendChild(el('tr', {}, el('td', { colspan: '7', class: 'muted' }, 'Nenhuma movimentação registrada.')));
}

// ---------- Relatórios ----------
async function renderRelatorios() {
  activeTemplate('relatorios');
  document.getElementById('rep-apply-btn').addEventListener('click', loadReports);
  await loadReports();
}

async function loadReports() {
  const from = document.getElementById('rep-from').value;
  const to = document.getElementById('rep-to').value;
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);

  const [summary, topProducts, slowMoving] = await Promise.all([
    api.get(`/reports/sales-summary?${qs.toString()}`),
    api.get(`/reports/top-products?${qs.toString()}`),
    api.get('/reports/slow-moving'),
  ]);

  document.getElementById('rep-total').textContent = formatMoney(summary.total);
  document.getElementById('rep-count').textContent = String(summary.count);

  const byDayBody = document.getElementById('rep-by-day');
  byDayBody.innerHTML = '';
  Object.entries(summary.byDay).sort().reverse().forEach(([day, total]) => {
    byDayBody.appendChild(el('tr', {}, [el('td', {}, day), el('td', {}, formatMoney(total))]));
  });
  if (Object.keys(summary.byDay).length === 0) byDayBody.appendChild(el('tr', {}, el('td', { colspan: '2', class: 'muted' }, 'Sem vendas no período.')));

  const topBody = document.getElementById('rep-top-products');
  topBody.innerHTML = '';
  topProducts.forEach((p) => {
    topBody.appendChild(el('tr', {}, [el('td', {}, p.name), el('td', {}, String(p.quantitySold)), el('td', {}, formatMoney(p.revenue))]));
  });
  if (topProducts.length === 0) topBody.appendChild(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'Sem vendas no período.')));

  const slowBody = document.getElementById('rep-slow-moving');
  slowBody.innerHTML = '';
  slowMoving.forEach((p) => {
    slowBody.appendChild(el('tr', {}, [el('td', {}, p.name), el('td', {}, String(p.currentStock)), el('td', {}, formatMoney(p.capitalParado))]));
  });
  if (slowMoving.length === 0) slowBody.appendChild(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'Nenhum produto parado.')));
}

// ---------- Usuários ----------
async function renderUsuarios() {
  activeTemplate('usuarios');
  document.getElementById('new-user-btn').addEventListener('click', () => openUserForm(null));
  await loadUsers();
}

async function loadUsers() {
  const users = await api.get('/users');
  const body = document.getElementById('users-list');
  body.innerHTML = '';
  users.forEach((u) => {
    body.appendChild(el('tr', {}, [
      el('td', {}, u.name),
      el('td', {}, u.email),
      el('td', {}, u.role === 'ADMIN' ? 'Administrador' : 'Funcionário'),
      el('td', {}, u.active ? 'Sim' : 'Não'),
      el('td', {}, el('button', { class: 'small secondary', type: 'button', onclick: () => openUserForm(u) }, 'Editar')),
    ]));
  });
}

function openUserForm(user) {
  const modal = openModal('tpl-user-form');
  const isEdit = Boolean(user);

  document.getElementById('user-form-title').textContent = isEdit ? 'Editar usuário' : 'Novo usuário';
  document.getElementById('u-email-label').style.display = isEdit ? 'none' : '';
  document.getElementById('u-email').style.display = isEdit ? 'none' : '';
  document.getElementById('u-email').required = !isEdit;
  document.getElementById('u-active-label').style.display = isEdit ? '' : 'none';
  document.getElementById('u-active').style.display = isEdit ? '' : 'none';
  document.getElementById('u-password-label').textContent = isEdit ? 'Nova senha (deixe em branco para manter)' : 'Senha';
  document.getElementById('u-password').required = !isEdit;

  if (isEdit) {
    document.getElementById('u-id').value = user.id;
    document.getElementById('u-name').value = user.name;
    document.getElementById('u-role').value = user.role;
    document.getElementById('u-active').checked = user.active;
  }

  document.getElementById('user-cancel-btn').addEventListener('click', () => closeModal(modal));

  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('user-form-msg');
    msg.hidden = true;
    const password = document.getElementById('u-password').value;

    try {
      if (isEdit) {
        const payload = {
          name: document.getElementById('u-name').value,
          role: document.getElementById('u-role').value,
          active: document.getElementById('u-active').checked,
        };
        if (password) payload.password = password;
        await api.put(`/users/${user.id}`, payload);
      } else {
        await api.post('/users', {
          name: document.getElementById('u-name').value,
          email: document.getElementById('u-email').value,
          role: document.getElementById('u-role').value,
          password,
        });
      }
      closeModal(modal);
      await loadUsers();
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
}

// ---------- Utils ----------
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
