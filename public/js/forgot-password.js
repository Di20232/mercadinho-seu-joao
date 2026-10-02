const form = document.getElementById('forgot-form');
const msg = document.getElementById('forgot-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.hidden = true;

  const email = document.getElementById('email').value.trim();
  try {
    const data = await api.post('/auth/forgot-password', { email });
    // O link de redefinição volta na própria resposta: vai direto para a tela
    // de nova senha. Usa só caminho + query para ficar na origem atual — o
    // servidor monta o link com APP_BASE_URL, que pode apontar para outra
    // porta (ex: Docker expõe 3100, o app escuta 3000).
    const resetUrl = data && data.resetUrl;
    if (resetUrl) {
      const url = new URL(resetUrl, location.origin);
      location.href = url.pathname + url.search;
      return;
    }
    msg.className = 'success';
    msg.textContent = data.message || 'Se o e-mail estiver cadastrado, as instruções foram enviadas.';
    msg.hidden = false;
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
    msg.hidden = false;
  }
});
