const app = require('./app');
const config = require('./config');
const { scheduleDailyAlerts } = require('./jobs/dailyAlerts');

// Rede de segurança contra falha catastrófica do processo: qualquer erro que,
// por algum descuido, escape do tratamento normal do Express (ex: uma
// promise rejeitada fora do ciclo de requisição) é registrado em vez de
// derrubar o servidor inteiro. Exceções síncronas não tratadas (uncaughtException)
// deixam o processo em estado potencialmente inconsistente — nesse caso registramos
// e encerramos de forma controlada, para que o gerenciador de processo (Docker,
// Render, PM2 etc.) reinicie o serviço automaticamente, em vez de deixá-lo travado
// ou corrompido no ar.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Promise rejeitada sem tratamento:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] Exceção não tratada — encerrando para reinício controlado:', err);
  process.exit(1);
});

const server = app.listen(config.port, () => {
  console.log(`Contro Vend rodando na porta ${config.port} (${config.nodeEnv})`);
  scheduleDailyAlerts();
});

function shutdown(signal) {
  console.log(`[server] ${signal} recebido, encerrando graciosamente...`);
  server.close(() => process.exit(0));
  // Se alguma conexão ficar pendurada, força o encerramento em vez de travar o processo.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
