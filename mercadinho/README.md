# Mercadinho do Seu João — controle de estoque

MVP do sistema de controle de estoque para um mercado de bairro. Feito para ser usado
**pelo celular, andando pela loja**, por gente que não tem intimidade com computador.

O sistema resolve os dois problemas que o cliente levantou na entrevista:

1. **Falta de produto** — avisa antes de acabar, com limite mínimo que muda conforme o dia
   da semana (na sexta o açougue precisa de mais estoque que na segunda).
2. **Excesso e vencimento** — avisa o que está perto de vencer, o que está parado no
   balcão sem sair, e soma sozinho o prejuízo das perdas do mês.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Python 3.11 + Flask 3 + SQLAlchemy 2 (ORM) |
| Banco de dados | **PostgreSQL 16** (psycopg2) |
| Migrações | Flask-Migrate (Alembic) |
| Frontend | HTML5 + CSS + **Bootstrap 5.3** + JavaScript puro (sem build step) |
| Login | Flask-Login, usuário e senha com papéis — sem OAuth |
| Alertas | Bot do Telegram (opcional) + caixa de avisos dentro do sistema |
| Testes | pytest (22 testes, incluindo os 5 casos de uso do cliente) |

O Bootstrap e os ícones são **servidos pelo próprio sistema** (`app/static/vendor/`),
não por CDN: numa loja com internet oscilando, a tela continua funcionando.

---

## Rodando o projeto

### Pré-requisitos
- Python 3.11+
- PostgreSQL 16 acessível (local ou na nuvem)

### Passo a passo

```bash
cd mercadinho

python3 -m venv .venv
source .venv/bin/activate            # no Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env                 # ajuste a DATABASE_URL e a SECRET_KEY
createdb mercadinho                  # crie o banco no PostgreSQL

export FLASK_APP=wsgi.py             # no Windows: set FLASK_APP=wsgi.py
flask db upgrade                     # cria as tabelas
python dados_demo.py                 # carga de demonstração (opcional, recomendado)

python run.py
```

Acesse **http://localhost:5000**.

> Sem a carga de demonstração, crie só o administrador: `flask criar-admin`
> (usa `ADMIN_LOGIN` / `ADMIN_SENHA` do `.env`).

### Com Docker (sobe o app e o PostgreSQL juntos)

```bash
docker compose up -d --build
docker compose exec app flask db upgrade
docker compose exec app python dados_demo.py
```

Acesse **http://localhost:8000**.

---

## Entrar no sistema (dados de demonstração)

| Usuário | Senha | Papel | O que faz |
|---|---|---|---|
| `joao` | `joao123` | Dono | Cadastra tudo, vê todos os avisos e relatórios |
| `maria` | `maria123` | Dona | Mesmo acesso do Seu João |
| `lucas` | `lucas123` | Operador (sobrinho) | Lança entradas, cuida do dia a dia — **responsável pelas bebidas** |
| `cida` | `cida123` | Repositora | Dá baixa e recebe os avisos de açougue, frios e hortifruti |
| `bruno` | `bruno123` | Repositor | Dá baixa e recebe os avisos de mercearia e limpeza |

---

## As telas

| Tela | Para quê |
|---|---|
| **Início** | Semáforo do estoque: quantos produtos estão *tá acabando* / *tá baixando* / *tudo certo*, com os avisos do usuário no topo e botão `−1` para dar baixa sem sair da tela |
| **Saiu** | Registra saída (venda no balcão ou baixa manual): escolhe o produto, toca em + / −, confirma |
| **Chegou** | Registra a mercadoria recebida, com data de validade quando o produto estraga |
| **Avisos** | Caixa de avisos — cada pessoa vê só os produtos que são dela; o dono vê tudo |
| **Comprar** | Lista de compras com a quantidade **já calculada** pelo sistema e o porquê |
| **Produtos** | Cadastro: nome, setor, se estraga, limite mínimo, limite de fim de semana e quem repõe |
| **Painel completo** | Tudo numa tela: o que está acabando, o que vai vencer, o que está parado, o que comprar e **quem vai receber cada aviso** |
| **Relatório de perdas** | Prejuízo do mês somado sozinho, por motivo e por produto |
| **Pessoas e feriados** | Cadastro de usuários e das datas comemorativas que reforçam o limite mínimo |

---

## Perfis e permissões

| Ação | Dono | Operador | Repositor |
|---|:---:|:---:|:---:|
| Ver o painel e os avisos | ✅ | ✅ | ✅ |
| Registrar saída e perda | ✅ | ✅ | ✅ |
| Registrar entrada de mercadoria | ✅ | ✅ | — |
| Cadastrar e editar produtos | ✅ | ✅ | — |
| Ver relatórios | ✅ | ✅ | — |
| Cadastrar pessoas e feriados | ✅ | — | — |

**Regra que o cliente fez questão:** o aviso de reposição vai para **quem cuida daquele
produto**, e não para todo mundo. Quem é dono da loja vê todos os avisos (é ele quem
compra); os funcionários veem apenas os seus.

---

## Modelo de dados

```
Usuario ──< Produto ──< LoteEstoque ──< MovimentoEstoque
              │  │            │
              │  │            └── data_validade (só perecível)
              │  ├──< Alerta >── Usuario (destinatário)
              │  └──< ListaCompraSugerida
              └── responsavel_padrao ── Usuario

DiaEspecial (feriados e datas comemorativas)
```

| Tabela | Campos principais |
|---|---|
| `usuario` | nome, login, senha_hash, papel (admin/operador/repositor), contato_telegram, ativo |
| `produto` | nome, categoria (perecível/não perecível), setor, unidade_medida, **limite_minimo**, **limite_minimo_fim_de_semana**, dias_aviso_validade, preco_custo, preco_venda, responsavel_padrao_id, ativo |
| `lote_estoque` | produto_id, quantidade, quantidade_inicial, data_entrada, data_validade, origem_compra, custo_unitario |
| `movimento_estoque` | produto_id, lote_id, tipo (entrada/saída/perda), quantidade, data_hora, usuario_id, motivo (vencido/estragado/danificado), valor_estimado |
| `alerta` | produto_id, tipo (limite_minimo/validade_proxima/parado_perecivel), destinatario_id, data_criacao, status, mensagem, enviado_telegram |
| `lista_compra_sugerida` | produto_id, quantidade_sugerida, data_geracao, justificativa, comprado |
| `dia_especial` | data, descricao |

O **estoque atual nunca é digitado**: é sempre a soma dos lotes que ainda têm saldo.
As saídas consomem primeiro o lote que vence antes (FEFO), que é o que se faz na gôndola.

---

## As regras de negócio

### Limite mínimo que muda de dia (a regra do contrafilé)

O cliente contou que 2 kg de contrafilé é tranquilo numa segunda e crítico numa sexta.
Por isso cada produto tem dois limites:

- `limite_minimo` — vale de segunda a quinta;
- `limite_minimo_fim_de_semana` — vale na **sexta, sábado, domingo, feriado e véspera de
  feriado**; se ficar em branco, o sistema usa o limite normal.

O semáforo compara o estoque com o limite **do dia**:

| Cor | Quando | O que a tela diz |
|---|---|---|
| 🔴 vermelho | estoque **abaixo** do mínimo do dia (ou zerado) | "Tá acabando o Contrafilé: só tem 1,1 kg" |
| 🟡 amarelo | estoque entre o mínimo e 1,5× o mínimo | "O Arroz 5kg tá baixando: 12 pct" |
| 🟢 verde | acima disso | — |

Ficar *exatamente* no mínimo ainda é amarelo — é o que faz 2 kg na segunda ser tranquilo
e na sexta (mínimo 8 kg) ser crítico.

### Validade e produto parado

- Alerta de vencimento com `DIAS_AVISO_VALIDADE` dias de antecedência (padrão **3**,
  como o cliente pediu); dá para ajustar por produto.
- Perecível **com estoque e sem nenhuma saída** há `DIAS_PERECIVEL_PARADO` dias (padrão
  **2**) vira aviso de risco de perda — é o caso da carne parada no balcão.

### Lista de compras

Para cada produto abaixo do limite do dia, o sistema calcula:

```
alvo        = maior(limite_do_dia × 2, média de saída por dia × DIAS_COBERTURA_COMPRA)
a comprar   = arredonda(alvo − estoque atual)
```

A média de saída vem dos últimos 14 dias de movimentação. Produto vendido em kg ou litro
arredonda de meio em meio; o resto arredonda para cima. A justificativa vem escrita em
português simples: *"Só tem 1,1 kg e o mínimo é 8 kg (hoje é sexta-feira, sai mais).
Costuma sair 0,9 kg por dia"*.

### Perdas

Toda perda exige um motivo (**venceu**, **estragou**, **quebrou/danificou**). O sistema
guarda o valor em R$ usando o custo do lote (ou o custo do produto) e o relatório do mês
soma sozinho — o dono não faz conta nenhuma.

---

## Alertas por Telegram

Canal principal de aviso, escolhido por ser **gratuito** e já estar no celular de todo
mundo. Para ligar:

1. Fale com o [@BotFather](https://t.me/BotFather) no Telegram, crie um bot e copie o token.
2. Ponha o token em `TELEGRAM_BOT_TOKEN` no `.env`.
3. Cada pessoa manda uma mensagem para o bot; pegue o `chat_id` em
   `https://api.telegram.org/bot<TOKEN>/getUpdates` e preencha no cadastro da pessoa.

Sem token configurado, **nada quebra**: os avisos continuam aparecendo na tela "Avisos".
O envio é sempre um canal a mais, nunca a única cópia da informação.

Para disparar a checagem automaticamente uma vez por dia (cron ou agendador do provedor):

```bash
flask verificar-alertas     # confere estoque, validade e produtos parados
flask gerar-lista-compras   # monta a lista de compras do dia
```

---

## Testes

```bash
createdb mercadinho_test          # banco separado, definido em TEST_DATABASE_URL
python -m pytest -q
```

Os testes de `testes/test_casos_de_uso.py` são exatamente os **cinco casos de aceitação**
combinados com o cliente:

| Teste | Caso do cliente |
|---|---|
| `test_caso_1_contrafile_critico_na_sexta_e_tranquilo_na_segunda` | A venda baixa o estoque; 2 kg é crítico na sexta e tranquilo na segunda |
| `test_caso_2_carne_parada_no_balcao_vira_risco_de_perda` | Carne há 2 dias sem sair é sinalizada antes de estragar |
| `test_caso_3_lista_de_compras_da_sexta_aponta_carne_carvao_e_cerveja` | Na sexta o sistema aponta o que não pode faltar no fim de semana |
| `test_caso_4_perda_por_vencimento_entra_sozinha_no_relatorio_do_mes` | A perda com motivo aparece somada no relatório, sem conta manual |
| `test_caso_5_alerta_de_bebidas_vai_so_para_o_responsavel` | O sobrinho recebe o aviso de bebidas; os outros funcionários não |

---

## Demonstração do cenário "sexta-feira / véspera de feriado"

O dono pode olhar o sistema **como se fosse outro dia**, sem mexer nos dados:
no rodapé da tela inicial, em *"Ver como fica em outro dia"*, escolha uma sexta-feira e
toque em **Ver**. Uma faixa laranja aparece no topo enquanto o modo está ligado, e os
limites reforçados entram em vigor na hora. Para cadastrar um feriado, use
*Pessoas e feriados* — o limite reforçado passa a valer também na véspera.

---

## Configuração (.env)

| Variável | Padrão | Para quê |
|---|---|---|
| `SECRET_KEY` | — | Assina a sessão de login. **Troque em produção** |
| `DATABASE_URL` | `postgresql+psycopg2://postgres:postgres@localhost:5432/mercadinho` | Banco PostgreSQL |
| `TEST_DATABASE_URL` | `...:5432/mercadinho_test` | Banco usado pelos testes |
| `DIAS_AVISO_VALIDADE` | `3` | Antecedência do aviso de vencimento |
| `DIAS_PERECIVEL_PARADO` | `2` | Dias sem saída para virar risco de perda |
| `DIAS_COBERTURA_COMPRA` | `3` | Dias de venda que a lista de compras cobre |
| `DIAS_MEDIA_CONSUMO` | `14` | Janela usada para calcular a média de saída |
| `TELEGRAM_BOT_TOKEN` | vazio | Liga o envio pelo Telegram |
| `ALERTA_COPIA_ADMIN` | `true` | Manda cópia dos avisos para os donos |
| `ADMIN_LOGIN` / `ADMIN_SENHA` / `ADMIN_NOME` | `joao` / `trocar123` | Usado por `flask criar-admin` |

---

## Publicando (baixo custo)

O projeto roda em qualquer serviço que aceite Python + PostgreSQL — Railway, Render,
Fly.io. Em produção use o `Dockerfile` (gunicorn) ou:

```bash
gunicorn --bind 0.0.0.0:8000 --workers 2 wsgi:app
```

Defina `SECRET_KEY` e `DATABASE_URL` nas variáveis de ambiente do provedor e rode
`flask db upgrade` no primeiro deploy. O custo fica dentro do teto do cliente: uma
instância pequena com Postgres gerenciado, e o Telegram não cobra pelo bot.

---

## Fora do escopo deste MVP

Conforme combinado, **não** estão implementados: previsão de demanda sazonal avançada
(Natal, Páscoa), integração com PDV/caixa, cadastro de fornecedores e prazos de entrega,
compras consignadas, fluxo de caixa e reconhecimento de produto por foto. Também não há
dependência de leitor de código de barras — todo cadastro e toda baixa funcionam por
digitação e toque na lista.

## Estrutura de pastas

```
mercadinho/
├── app/
│   ├── __init__.py          fábrica da aplicação, filtros e comandos de terminal
│   ├── config.py            configuração lida do .env
│   ├── models.py            as 7 tabelas do sistema
│   ├── seguranca.py         permissões por papel
│   ├── blueprints/          rotas (auth, painel, produtos, movimentos, alertas, ...)
│   ├── servicos/            regras de negócio (estoque, alertas, compras, relatórios)
│   ├── static/              CSS, JavaScript e o Bootstrap embarcado
│   └── templates/           telas em Jinja2 + Bootstrap
├── migrations/              migrações do banco (Alembic)
├── testes/                  pytest — inclui os 5 casos de aceitação
├── dados_demo.py            carga de demonstração da loja do Seu João
├── run.py / wsgi.py         desenvolvimento / produção
├── Dockerfile               imagem de produção (gunicorn)
└── docker-compose.yml       app + PostgreSQL para rodar localmente
```
