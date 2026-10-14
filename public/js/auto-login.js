async function autoLogin() {
  const status = document.getElementById('status');

  try {
    status.textContent = 'Solicitando sessão de demonstração...';

    const response = await fetch('/api/auth/auto-login', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Auto-login indisponível.');
    }

    if (data.role !== 'CASHIER') {
      throw new Error('Auto-login bloqueado: o usuário de demonstração precisa ser Caixa.');
    }

    status.textContent = '✅ Login de Caixa realizado! Redirecionando...';
    status.className = 'status success';

    setTimeout(() => {
      window.location.href = '/app.html';
    }, 800);
  } catch (error) {
    status.textContent = `❌ ${error.message}`;
    status.className = 'status error';
  }
}

window.addEventListener('load', autoLogin);
