// Compatibilidade para quem ainda chama `node reset-password.js`.
// A implementação segura fica em prisma/resetPassword.js e exige RESET_EMAIL e
// RESET_PASSWORD no ambiente; nenhuma senha padrão é usada ou exibida.
require('./prisma/resetPassword');
