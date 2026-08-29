"""As telas abrem, mostram o semaforo e falam em portugues simples."""
from datetime import date, timedelta
from decimal import Decimal

from app.extensions import db
from app.models import Categoria
from app.servicos import estoque as servico
from conftest import criar_produto, entrar


def _loja_montada(dono):
    arroz = criar_produto("Arroz 5kg", limite_minimo=Decimal("10"), responsavel_padrao=dono)
    leite = criar_produto("Leite integral 1L", categoria=Categoria.PERECIVEL,
                          setor="Frios e laticínios", limite_minimo=Decimal("6"),
                          preco_custo=Decimal("4.20"), responsavel_padrao=dono)
    servico.registrar_entrada(arroz, 3, dono)          # abaixo do minimo
    servico.registrar_entrada(leite, 20, dono, data_validade=date.today() + timedelta(days=2))
    db.session.commit()
    return arroz, leite


def test_painel_mostra_o_semaforo_e_a_frase_simples(app, client, dono):
    _loja_montada(dono)
    entrar(client, "joao")
    pagina = client.get("/").get_data(as_text=True)

    assert "Como está o estoque" in pagina
    assert "Tá acabando o Arroz 5kg" in pagina
    assert "vence em 2 dias" in pagina
    assert "threshold" not in pagina.lower()          # nada de termo tecnico na tela


def test_painel_consolidado_junta_tudo(app, client, dono):
    _loja_montada(dono)
    entrar(client, "joao")
    pagina = client.get("/consolidado").get_data(as_text=True)

    for secao in ("O que está acabando", "O que vai vencer", "O que precisa comprar",
                  "Quem vai receber o aviso"):
        assert secao in pagina


def test_lista_de_compras_abre_com_a_quantidade_calculada(app, client, dono):
    _loja_montada(dono)
    entrar(client, "joao")
    pagina = client.get("/compras/").get_data(as_text=True)
    assert "Arroz 5kg" in pagina
    assert "O sistema já calculou a quantidade" in pagina


def test_relatorio_de_perdas_soma_sozinho(app, client, dono):
    from app.models import MotivoPerda
    _, leite = _loja_montada(dono)
    servico.registrar_perda(leite, 3, dono, MotivoPerda.VENCIDO)
    db.session.commit()

    entrar(client, "joao")
    pagina = client.get("/relatorios/perdas").get_data(as_text=True)
    assert "R$ 12,60" in pagina                      # 3 x R$ 4,20, somado pelo sistema


def test_baixa_rapida_pelo_painel(app, client, dono):
    arroz, _ = _loja_montada(dono)
    entrar(client, "joao")
    resposta = client.post("/api/saida-rapida", json={"produto_id": arroz.id, "quantidade": 1})
    dados = resposta.get_json()

    assert dados["ok"] is True
    assert dados["estoque"] == "2"
    assert servico.estoque_atual(arroz) == Decimal("2")


def test_dia_de_teste_muda_o_limite_na_tela(app, client, dono):
    """O dono pode olhar o sistema como se fosse uma sexta-feira."""
    contrafile = criar_produto("Contrafilé", categoria=Categoria.PERECIVEL, setor="Açougue",
                               unidade_medida="kg", limite_minimo=Decimal("2"),
                               limite_minimo_fim_de_semana=Decimal("8"),
                               responsavel_padrao=dono)
    servico.registrar_entrada(contrafile, 4, dono,
                              data_validade=date.today() + timedelta(days=15))
    db.session.commit()

    entrar(client, "joao")
    client.post("/dia-de-teste", data={"data": "2026-09-11"}, follow_redirects=True)
    pagina = client.get("/").get_data(as_text=True)

    assert "sexta-feira" in pagina
    assert "Tá acabando o Contrafilé" in pagina
