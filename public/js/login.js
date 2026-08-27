(async () => {
  // Se já existe sessão válida, pula direto para o app.
  try {
    await api.get('/auth/me');
    location.href = '/app.html';
    return;
  } catch {
    // não autenticado — segue para o formulário de login
  }
})();

const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    await api.post('/auth/login', { email, password });
    location.href = '/app.html';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});
