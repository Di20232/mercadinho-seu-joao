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
const loginInput = document.getElementById('login');
const passwordInput = document.getElementById('password');

function showLoginError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

// O campo aceita e-mail ou nome de usuário (ex: diego1239), então não há
// formato a checar aqui — quem decide qual dos dois é o servidor.
function validateLoginFields(login, password) {
  if (!login) return 'E-mail ou usuário: informe o e-mail ou o usuário.';
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

  const login = loginInput.value.trim();
  const password = passwordInput.value;
  const fieldError = validateLoginFields(login, password);
  if (fieldError) {
    showLoginError(fieldError);
    return;
  }

  try {
    await api.post('/auth/login', { login, password });
    location.href = '/app.html';
  } catch (err) {
    showLoginError(friendlyLoginError(err));
  }
});
