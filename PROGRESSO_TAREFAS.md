# Acompanhamento de Tarefas — Mercadinho do João (16/10)

Este arquivo é lido e atualizado continuamente durante a execução das pendências.

---

## 📌 Configuração e Ambiente
- **Branch de trabalho**: `claude/pendencias-16-10`
- **Banco de testes**: `mercadinho_joao_test` (porta 5433 no container `mercadinho-seu-joao-db-1`)
- **String de conexão**: `postgresql://postgres:changeme_local_only@localhost:5433/mercadinho_joao_test?schema=public`
- **Banco de produção/desenvolvimento (`mercadinho_joao`)**: NUNCA tocado!
- **Linha de base dos testes**: suíte existente antes das novas coberturas (registro histórico: 23 testes).

---

## 🎯 Tarefas e Status

### 1. [Urgente] Recuperação de senha insegura — `src/routes/auth.js`
- [x] Resposta HTTP de `POST /api/auth/forgot-password` alterada para SEMPRE retornar 200 com mensagem genérica fixa.
- [x] `resetUrl` / token removido da resposta HTTP em TODOS os ambientes (inclusive desenvolvimento).
- [x] Link de reset escrito em `console.log` no servidor quando fora de produção (para testes manuais).
- [x] `public/js/forgot-password.js` atualizado para não redirecionar e exibir mensagem genérica.
- [x] Testes atualizados em `test/integration.test.js`:
  - Teste de uso único obtém token diretamente via Prisma.
  - Teste novo garantindo que a resposta nunca contém "token" nem "reset-password" (para e-mail existente e inexistente).
- [x] Teste executado e passando (35/35; última execução confirmada antes da integração SMTP).
- [ ] Commit próprio realizado.

### 2. Controle de estoque — `src/routes/stock.js`, `src/routes/sales.js`
- [x] Teste de cancelamento devolve estoque e grava movimentação `ADJUSTMENT`.
- [x] Teste de cancelamento duplicado retorna 409.
- [x] Teste de ajuste/perda grava `previousStock`, `newStock` e `quantity` corretos.
- [x] Teste de histórico filtra por `productId` e por `type`.
- [x] Teste de autorização: `CASHIER` bloqueado de `/entries`, `/adjustments`, `/movements` (403).
- [x] Teste de alerta de estoque mínimo: produtos com `currentStock <= minStock` aparecem em `/reports/forecast`.
- [x] Testes executados e passando (35/35; última execução confirmada antes da integração SMTP).
- [ ] Commit próprio realizado.

### 3. Relatório de vendas — `src/routes/reports.js` & `RELATORIO_DE_VENDAS_FIXES.md`
- [x] Auditoria de cada item de `RELATORIO_DE_VENDAS_FIXES.md`:
  1. CSP (CSS/JS externo no auto-login) -> `public/auto-login.html:7,24` (Implementado).
  2. Auto-login seguro (sem credenciais hardcoded, apenas CASHIER, bloqueado em prod) -> `src/routes/auth.js:126-150` e `src/config.js:67-71` (Implementado).
  3. Error handling em `loadReports()` (try/catch com `.error.notice`) -> `public/js/app.js:782-829` (Implementado).
  4. Filtro de data "Até" ajustado para 23:59:59.999 -> `src/routes/reports.js:18,42` (Implementado).
- [x] Teste de integração de relatório adicionado:
  - `to=YYYY-MM-DD` inclui o dia inteiro (já existia na linha 363).
  - `slow-moving` lista produtos parados com capital calculado (adicionado).
- [x] Testes executados e passando (35/35; última execução confirmada antes da integração SMTP).
- [ ] Commit próprio realizado.

---

## 📊 Linha de Base e Resultados de Teste
(Atualizado após execução dos testes contra `mercadinho_joao_test`)
- Última execução confirmada: `35 pass, 0 fail` (~10,2s), antes da integração SMTP pendente de nova confirmação nesta sessão.
