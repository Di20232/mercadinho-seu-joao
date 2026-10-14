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
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

function showLoginError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function validateLoginFields(email, password) {
  if (!email) return 'E-mail: informe o e-mail usado no cadastro.';
  if (!emailInput.validity.valid) return 'E-mail: formato inválido. Verifique se digitou corretamente.';
  if (!password) return 'Senha: informe a senha.';
  return '';
}

function friendlyLoginError(err) {
  const message = err && err.message ? err.message : '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Servidor indisponível. Verifique se o sistema está aberto e tente novamente.';
  }
  if (message === 'Erro interno do servidor.') {
    return 'Não foi possível concluir o login. Verifique se o banco de dados/servidor está rodando e tente novamente.';
  }
  return message || 'Não foi possível concluir o login. Verifique os dados e tente novamente.';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const fieldError = validateLoginFields(email, password);
  if (fieldError) {
    showLoginError(fieldError);
    return;
  }

  try {
    await api.post('/auth/login', { email, password });
    location.href = '/app.html';
  } catch (err) {
    showLoginError(friendlyLoginError(err));
  }
});
