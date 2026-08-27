# Contro Vend

Sistema web de controle de vendas e estoque para pequeno comerciante (mercadinho de secos e molhados). Roda na nuvem — não precisa ser instalado na máquina do cliente, só um navegador.

📖 **[Documentação técnica completa](DOCUMENTATION.md)** — stack tecnológica, arquitetura, modelo de dados, perfis de acesso e detalhamento de cada funcionalidade. Este README cobre o dia a dia: instalar, rodar, publicar e as decisões de segurança.

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

## Rodando com Docker Compose (ambiente local persistente)

Alternativa ao passo a passo acima para quem já tem Docker instalado: sobe o app **e** o banco como containers de longa duração, com os dados gravados num volume — sobrevivem a fechar o terminal, parar os containers, e até reiniciar a máquina (o Docker Desktop precisa voltar a subir).

```bash
docker compose up -d --build
docker compose exec app npm run seed             # cria o administrador (senha padrão: TrocarEssaSenha123!)
docker compose exec app npm run seed:products     # opcional
docker compose exec app npm run simulate:sales    # opcional: histórico de vendas de exemplo
```

Acesse `http://localhost:3100`. Para customizar (senha do banco, e-mail/senha do administrador, SMTP), crie um `.env` na raiz do projeto — o `docker-compose.yml` lê as mesmas variáveis do `.env.example`, com valores padrão só para uso local.

- `docker compose stop` / `docker compose start` — para e liga de novo sem perder nada.
- `docker compose down` (sem `-v`) — remove os containers mas mantém o volume/dados.
- `docker compose down -v` — **apaga os dados de vez** (só use se for isso mesmo que quiser).

⚠️ Este `docker-compose.yml` é para desenvolvimento/demonstração local (roda em `http://` sem HTTPS, com um `JWT_SECRET` padrão). Para publicar de verdade na internet, siga a seção **Publicando na nuvem** abaixo, não este arquivo.

### Carga de produtos de exemplo

`npm run seed:products` ([prisma/seedProducts.js](prisma/seedProducts.js)) insere um catálogo de exemplo de mercadinho (arroz, feijão, laticínios, limpeza, higiene etc.), com datas de validade variadas — alguns vencendo em poucos dias, outros com validade longa, e alguns sem validade (produtos de limpeza/higiene, como definido para o sistema). Alguns produtos já entram com estoque abaixo do mínimo, então o Painel mostra alertas reais assim que você loga.

### Simulação de histórico de vendas

`npm run simulate:sales` ([prisma/simulateSales.js](prisma/simulateSales.js)) gera um histórico de vendas realista, espalhado nos últimos 14 dias (`SIMULATE_DAYS` para mudar a janela) — ao contrário de uma venda feita pela tela ou pela API (que sempre grava a data de agora), este script "volta no tempo", alternando entre o administrador e um caixa de demonstração. Isso é o que faz o **Relatório de vendas por dia** mostrar uma tendência de verdade em vez de um único dia, e a **previsão de esgotamento** calcular uma taxa de venda diária real em vez de zero. Requer produtos já cadastrados (`npm run seed:products` ou seus próprios produtos).

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

O projeto passou por várias rodadas de auditoria de segurança: releitura de cada arquivo, correção das brechas encontradas, e uma bateria de testes reais (não só análise de código) contra um PostgreSQL de verdade rodando em Docker — incluindo simulações completas de ataque (funcionário mal-intencionado, sessão comprometida, força bruta). Entre os testes: 20 vendas simultâneas contra um produto com 10 unidades em estoque (resultado: exatamente 10 sucessos, 10 rejeitados, estoque final zero — nunca negativo), tentativas de SQL injection em parâmetros de rota e campos de texto (neutralizadas pelo Prisma), payload XSS armazenado e verificado ao vivo no navegador (nunca executa — vira texto escapado na tela), JWT adulterado e ataque `alg:none` (ambos rejeitados), queda total do banco de dados no meio de requisições (servidor devolveu erro limpo e se recuperou sozinho, sem reiniciar), JSON malformado/gigante/com aninhamento profundo, datas de calendário impossíveis (ex: 30 de fevereiro), bypass de autorização em cada rota administrativa a partir de uma conta de funcionário, **um funcionário demitido que continuava vendendo com o token antigo** (achado crítico, corrigido), **contorno do limite de tentativas de login forjando o cabeçalho X-Forwarded-For** (achado crítico, corrigido), adulteração de preço/vendedor no corpo da requisição de venda (ignorada — servidor sempre recalcula do banco), directory traversal nos arquivos estáticos, poluição de protótipo via query string, e **uma condição de corrida que perdia 14 de 30 entradas de estoque simultâneas silenciosamente** (achado crítico, corrigido). Vinte e uma brechas de segurança reais foram encontradas e corrigidas no total.

Depois do redesenho visual e da adição do script de simulação de vendas, foi feita uma rodada de regressão (suíte automatizada + cabeçalhos de segurança + CSRF + rate limit + `npm audit`, tudo contra um banco descartável separado) para confirmar que nenhuma mudança recente abriu brecha nova — nenhuma encontrada. Nessa mesma rodada, ao montar o `docker-compose.yml`, a imagem baseada em Alpine falhou silenciosamente ao aplicar migrations (o motor do Prisma não detectava a versão de OpenSSL do Alpine e entrava em loop de reinício) — trocada por uma base Debian (`node:20-bookworm-slim`), recomendada pelo próprio Prisma para evitar essa classe de problema.

## Auditoria de qualidade, performance e UX

Além da segurança, o projeto passou por uma rodada de auditoria de qualidade/UX/performance:

- **Campo de quantidade no carrinho perdia o foco a cada tecla** — o carrinho de vendas recriava o `<input>` inteiro a cada dígito digitado, então o segundo dígito de "12" nunca chegava a ser digitado no campo. Corrigido para atualizar só o subtotal/total sem recriar o input; testado ao vivo (foco confirmado persistindo em múltiplas teclas seguidas).
- **N+1 query na criação de vendas**: uma venda com N itens fazia N consultas sequenciais de leitura antes de N gravações. Corrigido para 1 consulta em lote + N gravações (as gravações continuam individuais, pois cada uma precisa do `UPDATE` atômico condicional que impede sobrevenda).
- **Overflow horizontal em telas estreitas**: tabelas largas (ex: Produtos, com 8 colunas) empurravam a página inteira para o lado num celular. Corrigido envolvendo cada tabela num contêiner com rolagem própria — testado matematicamente via navegador (largura da página sem overflow, tabela rolando dentro do próprio espaço).
- **Acessibilidade de formulários**: 15 campos tinham `<label>` visualmente ao lado do campo mas sem associação programática (`for`/`id`) — leitores de tela não conseguiam ligar o rótulo ao campo. Corrigido em todos os formulários, e adicionado `aria-label` nos campos de busca (que não têm rótulo visível por design).
- **Duplicação de lógica** entre painel, relatórios e e-mail de alerta (cálculo de "estoque baixo/prestes a esgotar" e "produtos parados" estava repetido em 3 lugares) — extraída para funções compartilhadas em `src/forecast.js`.
- **Produto desativado não podia ser reativado** — funcional, não só de segurança: cobre o caso de uso central de desfazer uma desativação por engano.

## Testes automatizados

```bash
npm test
```

Roda uma suíte de testes de integração ([test/integration.test.js](test/integration.test.js)) com o test runner nativo do Node (`node:test`, sem dependências novas) contra um PostgreSQL real — sobe a aplicação de verdade em memória e faz requisições HTTP reais. Cobre regressão dos bugs mais graves encontrados na auditoria: condição de corrida em estoque concorrente (entradas e vendas simultâneas), revogação de sessão em tempo real, autorização por papel, CSRF, SQL injection, validação de data de calendário, limite de overflow numérico, e reativação de produto.

**Atenção**: a suíte apaga todos os dados do banco apontado por `DATABASE_URL` antes de rodar. Use sempre um banco dedicado a testes — nunca aponte para dados reais. Por segurança, a suíte recusa rodar a menos que o nome do banco contenha "test", ou que `ALLOW_DB_RESET=true` seja definido explicitamente.

## Testes realizados manualmente

Além da suíte automatizada, o sistema foi testado manualmente de ponta a ponta (API e navegador) em cada rodada de mudança: login, CRUD de produtos, venda com baixa de estoque, cancelamento de venda, entradas/ajustes de estoque, relatórios, gestão de usuários, alerta por e-mail, e responsividade em desktop/mobile.

## Próximos passos sugeridos (fora do escopo inicial)

- Leitor de código de barras via câmera do celular (a busca por código de barras já funciona digitando).
- Exportação de relatórios em PDF/Excel.
- Validade por lote de compra (hoje a validade é por produto, conforme decidido).
- Busca de produtos insensível a acento (hoje "feijao" não encontra "Feijão" — só busca por substring literal).
- Estados de carregamento explícitos na interface (hoje uma requisição lenta não mostra nenhum indicador visual de "carregando").
