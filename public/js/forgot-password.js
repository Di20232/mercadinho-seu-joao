const form = document.getElementById('forgot-form');
const msg = document.getElementById('forgot-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.hidden = true;

  const email = document.getElementById('email').value.trim();
  try {
    const data = await api.post('/auth/forgot-password', { email });
    // O servidor nunca devolve token ou link na resposta — em qualquer ambiente.
    // O usuário vê a mensagem genérica e receberá o link por e-mail (quando
    // SMTP estiver configurado) ou o administrador obtém o link pelo log do servidor.
    msg.className = 'success';
    msg.textContent = data.message || 'Se o e-mail estiver cadastrado, as instruções foram enviadas.';
    msg.hidden = false;
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
    msg.hidden = false;
  }
});
