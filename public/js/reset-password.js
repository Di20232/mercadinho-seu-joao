// Lê o token da query string, depois remove-o da URL com history.replaceState
// para reduzir o risco de vazamento (histórico do navegador, Referer, logs de
// proxy). O token fica só em memória (nesta variável) e é enviado no corpo
// do POST, não na URL.
const params = new URLSearchParams(location.search);
const token = params.get('token');
if (token) {
  history.replaceState(null, '', '/reset-password.html');
}

const form = document.getElementById('reset-form');
const msg = document.getElementById('reset-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.hidden = true;

  if (!token) {
    msg.className = 'error';
    msg.textContent = 'Link inválido: token ausente.';
    msg.hidden = false;
    return;
  }

  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm').value;

  if (password !== confirm) {
    msg.className = 'error';
    msg.textContent = 'As senhas não conferem.';
    msg.hidden = false;
    return;
  }
  if (password.length < 8) {
    msg.className = 'error';
    msg.textContent = 'A senha precisa ter ao menos 8 caracteres.';
    msg.hidden = false;
    return;
  }

  try {
    const data = await api.post('/auth/reset-password', { token, password });
    msg.className = 'success';
    msg.textContent = (data && data.message) || 'Senha redefinida com sucesso.';
    msg.hidden = false;
    form.querySelector('button[type="submit"]').disabled = true;
    // Redireciona para o login depois de alguns segundos.
    setTimeout(() => { location.href = '/index.html'; }, 3000);
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
    msg.hidden = false;
  }
});
