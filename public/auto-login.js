// Compatibilidade para URLs antigas que ainda referenciem /auto-login.js.
// A implementação canônica fica em /js/auto-login.js e usa o endpoint seguro
// /api/auth/auto-login, sem credenciais hardcoded no navegador.
const script = document.createElement('script');
script.src = '/js/auto-login.js';
document.head.appendChild(script);
