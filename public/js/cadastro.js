const form = document.getElementById('register-form');
const msg = document.getElementById('register-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.hidden = true;

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
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
    // O cadastro já abre a sessão (cookie definido na resposta), então vai
    // direto para o sistema, como depois de um login.
    await api.post('/auth/register', { name, email, password });
    location.href = '/app.html';
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
    msg.hidden = false;
  }
});
