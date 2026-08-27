# Contro Vend

Sistema web de controle de vendas e estoque para pequeno comerciante (mercadinho de secos e molhados). Roda na nuvem — não precisa ser instalado na máquina do cliente, só um navegador.

## O que o sistema faz

- **Vendas**: tela de caixa (busca produto por nome/código de barras, monta o carrinho, confirma a venda). Cada venda desconta o estoque automaticamente.
- **Estoque**: cadastro de produtos, entradas de mercadoria (compras), ajustes/baixas (perda, vencimento, quebra), e histórico completo de movimentações.
- **Previsão de esgotamento**: com base na média de vendas dos últimos 30 dias, o sistema estima em quantos dias cada produto vai acabar — para saber o que repor antes de faltar.
- **Produtos parados**: lista produtos com estoque mas sem nenhuma venda nos últimos 60 dias — ajuda a evitar comprar mais do que gira.
- **Alertas de validade**: produtos perto de vencer aparecem no painel (evita perda por produto vencido).
- **Alerta diário por e-mail** (opcional): resumo de estoque baixo, previsão de falta e validades próximas, enviado automaticamente uma vez por dia se o SMTP for configurado.
- **Perfis de usuário**: **administrador** (dono, acesso total) e **caixa** (funcionário, só registra vendas e vê estoque — não vê preço de custo/margem nem dados financeiros).

## Arquitetura

- **Backend**: Node.js + Express + PostgreSQL (via [Prisma ORM](https://www.prisma.io/)).
- **Frontend**: HTML/CSS/JS puro (sem build step), servido pelo próprio backend — simples de hospedar em qualquer provedor.
- **Banco de dados**: PostgreSQL. Provedores gratuitos que funcionam bem: [Neon](https://neon.tech), [Supabase](https://supabase.com), [Railway](https://railway.app), [Render](https://render.com/docs/free#free-postgresql).

## Rodando localmente (para desenvolvimento)

Pré-requisitos: Node.js 18+ e um PostgreSQL acessível (local ou na nuvem).

```bash
npm install
cp .env.example .env
# edite o .env com sua DATABASE_URL, JWT_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD
npm run prisma:migrate
npm run seed            # cria o primeiro usuário administrador
npm run seed:products   # opcional: carrega ~24 produtos de exemplo (secos e molhados) com validade
npm run dev
```

Acesse `http://localhost:3000`.

### Carga de produtos de exemplo

`npm run seed:products` ([prisma/seedProducts.js](prisma/seedProducts.js)) insere um catálogo de exemplo de mercadinho (arroz, feijão, laticínios, limpeza, higiene etc.), com datas de validade variadas — alguns vencendo em poucos dias, outros com validade longa, e alguns sem validade (produtos de limpeza/higiene, como definido para o sistema). Alguns produtos já entram com estoque abaixo do mínimo, então o Painel mostra alertas reais assim que você loga.

É seguro rodar mais de uma vez: identifica cada produto pelo código de barras e atualiza em vez de duplicar. Edite a lista no arquivo para refletir os produtos, preços e código de barras reais do cliente antes de usar em produção — os dados atuais são só um ponto de partida.

## Publicando na nuvem (exemplo: Render, Railway ou similar)

1. Crie um banco PostgreSQL gerenciado e copie a `DATABASE_URL`.
2. Configure as variáveis de ambiente do `.env.example` no painel do provedor (nunca coloque segredos no código).
3. Gere um `JWT_SECRET` forte, por exemplo com `openssl rand -base64 48`.
4. Defina `NODE_ENV=production` e `COOKIE_SECURE=true` (exige HTTPS, que esses provedores já entregam).
5. Comando de build: `npm install` (o `postinstall` já roda `prisma generate`).
6. Rode as migrations uma vez: `npm run prisma:deploy`.
7. Rode o seed uma vez: `npm run seed` (cria o administrador inicial).
8. Comando de start: `npm start`.

Depois do primeiro login, troque a senha do administrador em **Usuários**.

### Esqueci a senha do administrador

Se o único administrador esquecer a senha, não há tela de "esqueci minha senha" (de propósito — evita a superfície de ataque de um fluxo de recuperação por e-mail). Quem tem acesso ao servidor/banco pode redefinir via:

```bash
RESET_EMAIL=admin@example.com RESET_PASSWORD="NovaSenhaForte123!" npm run reset-password
```

Isso também reativa a conta, caso tenha sido desativada por engano.

## Decisões de segurança

- **Senhas**: nunca armazenadas em texto puro — hash com bcrypt (fator de custo 12).
- **Sessão**: JWT em cookie `httpOnly` + `Secure` (produção) + `SameSite=Lax`, então não é acessível via JavaScript nem enviado em requisições de terceiros.
- **CSRF**: além do `SameSite`, toda rota que altera dados exige um cabeçalho `X-Requested-With: fetch`, que só pode ser definido por JavaScript same-origin — formulários forjados em outro site não conseguem enviá-lo.
- **SQL Injection**: todo acesso ao banco passa pelo Prisma com parâmetros tipados; não há concatenação de string em nenhuma query.
- **XSS**: o frontend nunca usa `innerHTML` com dados vindos do servidor — toda renderização usa `textContent`/`createElement`.
- **Autorização**: cada rota checa o papel do usuário no servidor (não só esconde botões na tela) — testado explicitamente: um usuário "caixa" recebe `403` ao chamar a API de usuários e nunca recebe o preço de custo dos produtos na resposta.
- **Força bruta**: login limitado a 10 tentativas a cada 15 minutos por IP; mensagem de erro genérica (não revela se o e-mail existe).
- **Condição de corrida no estoque**: toda operação que soma/subtrai do estoque (venda, entrada de compra, ajuste/perda, cancelamento de venda) usa um `UPDATE` condicional atômico (`WHERE estoque` dentro dos limites) via `src/stockOps.js`, nunca "ler em JS e escrever de volta um valor absoluto" — requisições simultâneas para o mesmo produto nunca se perdem ou deixam o estoque negativo/acima do limite.
- **Exclusão de produtos/usuários**: é lógica (campo `active`), nunca física — preserva o histórico de vendas para relatórios e auditoria.
- **Erros**: mensagens de erro internas nunca vazam para o cliente (log no servidor, resposta genérica ao usuário).
- **Segredos**: `.env` nunca é versionado (`.gitignore`); a aplicação recusa subir em produção com `JWT_SECRET` fraco/ausente, e força cookie `Secure` em produção independentemente do `.env`.
- **Login sem oráculo de tempo**: o servidor gasta o mesmo tempo de CPU (bcrypt) tanto para e-mail inexistente quanto para senha errada, para não permitir enumerar contas cadastradas medindo a velocidade da resposta.
- **JWT com algoritmo fixo**: `HS256` é exigido explicitamente na verificação (não inferido), fechando qualquer brecha de ataque de confusão de algoritmo.
- **Filtros de busca validados**: parâmetros de data/enum em consultas (relatórios, histórico de estoque, vendas) são validados antes de chegar ao banco — entrada inválida vira um erro `400` claro, nunca um `500` genérico.
- **Limites contra estouro numérico**: o total de uma venda e o estoque resultante de uma entrada/ajuste têm um teto de segurança checado em código, para nunca esbarrar no limite de precisão das colunas do banco.
- **Rede de segurança do processo**: `uncaughtException`/`unhandledRejection` são capturados no nível do processo — um erro inesperado é registrado em log em vez de derrubar o servidor inteiro; se um erro verdadeiramente irrecuperável ocorrer, o processo se encerra de forma controlada para que o orquestrador (Docker/Render/PM2) reinicie o serviço automaticamente.
- **Revogação de sessão em tempo real**: cada requisição autenticada revalida no banco se o usuário ainda está ativo e qual é seu papel atual — desativar uma conta ou rebaixar um administrador tem efeito imediato, mesmo que o token JWT dele ainda não tenha expirado (até 8h de validade).
- **`trust proxy` seguro por padrão**: o servidor não confia no cabeçalho `X-Forwarded-For` a menos que `TRUST_PROXY` seja explicitamente configurado no `.env` — evita que qualquer requisição finja vir de um IP diferente a cada tentativa e contorne o limite de tentativas de login.
- **E-mail sempre criptografado**: a conexão SMTP exige TLS (implícito na porta 465, ou STARTTLS obrigatório em qualquer outra porta) — nunca envia a senha do SMTP nem os níveis de estoque em texto plano na rede, e nunca aceita um certificado não confiável ou de host errado (testado com um servidor SMTP simulado sem TLS e outro com certificado inválido — ambos corretamente recusados). E-mail só em texto puro, nunca HTML, eliminando riscos de phishing/renderização.
- **Detalhe de produto respeita o mesmo filtro da listagem**: um produto desativado fica invisível para quem não é admin também na rota de detalhe (`GET /products/:id`), não só na listagem — evita que alguém veja um produto descontinuado só por saber ou adivinhar o ID.
- **Recuperação de senha do administrador**: sem fluxo de "esqueci minha senha" por e-mail (superfície de ataque a menos), mas com um script de emergência (`npm run reset-password`) para quem já tem acesso ao servidor/banco não ficar trancado para sempre fora do próprio sistema.
- **Reativação de produto**: um produto desativado pode ser reativado (pela tela ou pela API) — antes não havia nenhuma forma de desfazer uma desativação a não ser editando o banco diretamente.
- **Limite de requisições realista**: o teto geral por IP (`API_RATE_LIMIT_MAX`, padrão 300/min) foi calibrado testando carga real — o valor inicial de 120/min chegava a bloquear vendas legítimas quando vários caixas da mesma loja (mesmo IP) vendiam ao mesmo tempo.

## Auditoria de segurança realizada

Depois da construção inicial, o projeto passou por duas rodadas de auditoria de segurança: releitura de cada arquivo, correção das brechas encontradas, e uma bateria de testes reais (não só análise de código) contra um PostgreSQL de verdade rodando em Docker — incluindo simulações completas de ataque (funcionário mal-intencionado, sessão comprometida, força bruta). Entre os testes: 20 vendas simultâneas contra um produto com 10 unidades em estoque (resultado: exatamente 10 sucessos, 10 rejeitados, estoque final zero — nunca negativo), tentativas de SQL injection em parâmetros de rota e campos de texto (neutralizadas pelo Prisma), payload XSS armazenado e verificado ao vivo no navegador (nunca executa — vira texto escapado na tela), JWT adulterado e ataque `alg:none` (ambos rejeitados), queda total do banco de dados no meio de requisições (servidor devolveu erro limpo e se recuperou sozinho, sem reiniciar), JSON malformado/gigante/com aninhamento profundo, datas de calendário impossíveis (ex: 30 de fevereiro), bypass de autorização em cada rota administrativa a partir de uma conta de funcionário, **um funcionário demitido que continuava vendendo com o token antigo** (achado crítico, corrigido), **contorno do limite de tentativas de login forjando o cabeçalho X-Forwarded-For** (achado crítico, corrigido), adulteração de preço/vendedor no corpo da requisição de venda (ignorada — servidor sempre recalcula do banco), directory traversal nos arquivos estáticos, e poluição de protótipo via query string. Treze brechas reais foram encontradas e corrigidas no total — detalhes de cada uma foram entregues em conversa.

## Testes realizados

## Próximos passos sugeridos (fora do escopo inicial)

- Leitor de código de barras via câmera do celular (a busca por código de barras já funciona digitando).
- Exportação de relatórios em PDF/Excel.
- Validade por lote de compra (hoje a validade é por produto, conforme decidido).
