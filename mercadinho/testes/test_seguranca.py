"""Testes das brechas encontradas na auditoria adversarial.

Cada teste aqui reproduz um ataque ou um dado hostil que, antes da correcao,
derrubava a pagina, corrompia o estoque ou dava acesso indevido.
"""
import threading
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.extensions import db
from app.models import Categoria, LoteEstoque, Papel, Produto, Usuario
from app.servicos import estoque as servico
from conftest import criar_produto, criar_usuario, entrar


# --------------------------------------------------------------------------
# Dados hostis nos formularios (antes: HTTP 500 ou estoque corrompido)
# --------------------------------------------------------------------------

@pytest.mark.parametrize("rota", ["/movimentos/entrada", "/movimentos/saida",
                                  "/movimentos/perda"])
def test_produto_id_nao_numerico_nao_derruba_a_pagina(app, client, dono, rota):
    entrar(client, "joao")
    resposta = client.post(rota, data={"produto_id": "abc", "quantidade": "1",
                                       "motivo": "vencido"})
    assert resposta.status_code < 500


@pytest.mark.parametrize("quantidade", ["NaN", "sNaN", "Infinity", "-Infinity", "1e999"])
def test_quantidade_nao_finita_nao_entra_no_estoque(app, client, dono, quantidade):
    """NaN quebrava a comparacao e Infinity passava direto para o saldo."""
    produto = criar_produto("Arroz 5kg")
    entrar(client, "joao")
    resposta = client.post("/movimentos/entrada",
                           data={"produto_id": produto.id, "quantidade": quantidade})

    assert resposta.status_code < 500
    assert servico.estoque_atual(produto) == Decimal("0")


def test_texto_maior_que_a_coluna_nao_derruba_o_cadastro(app, client, dono):
    entrar(client, "joao")
    resposta = client.post("/produtos/novo", data={
        "nome": "N" * 500, "categoria": "nao_perecivel", "setor": "S" * 300,
        "unidade_medida": "u" * 50, "limite_minimo": "1",
    }, follow_redirects=True)

    assert resposta.status_code < 500
    salvo = Produto.query.filter(Produto.nome.like("N%")).first()
    assert salvo is not None
    assert len(salvo.nome) <= 120 and len(salvo.setor) <= 60


def test_numero_maior_que_a_coluna_nao_derruba_o_cadastro(app, client, dono):
    entrar(client, "joao")
    resposta = client.post("/produtos/novo", data={
        "nome": "Gigante", "categoria": "nao_perecivel", "setor": "Mercearia",
        "unidade_medida": "un", "limite_minimo": "999999999999999999",
    }, follow_redirects=True)

    assert resposta.status_code < 500
    assert Produto.query.filter_by(nome="Gigante").first() is None


def test_limite_e_preco_negativos_nao_sao_gravados(app, client, dono):
    entrar(client, "joao")
    client.post("/produtos/novo", data={
        "nome": "Negativo", "categoria": "nao_perecivel", "setor": "Mercearia",
        "unidade_medida": "un", "limite_minimo": "-50", "preco_custo": "-9",
    }, follow_redirects=True)

    salvo = Produto.query.filter_by(nome="Negativo").first()
    if salvo is not None:
        assert salvo.limite_minimo >= 0
        assert (salvo.preco_custo or Decimal("0")) >= 0


# --------------------------------------------------------------------------
# Estoque em paralelo (antes: 24 kg vendidos de um estoque de 10 kg)
# --------------------------------------------------------------------------

def test_baixas_simultaneas_nao_vendem_mais_do_que_existe(app, dono):
    """Doze caixas dando baixa ao mesmo tempo no mesmo produto."""
    produto = criar_produto("Contrafilé", unidade_medida="kg", limite_minimo=Decimal("1"))
    servico.registrar_entrada(produto, 10, dono)
    db.session.commit()
    produto_id, dono_id = produto.id, dono.id

    largada = threading.Barrier(12)

    def dar_baixa():
        with app.app_context():
            largada.wait()
            try:
                p = db.session.get(Produto, produto_id)
                u = db.session.get(Usuario, dono_id)
                servico.registrar_saida(p, 2, u)
                db.session.commit()
            except servico.EstoqueInsuficiente:
                db.session.rollback()

    threads = [threading.Thread(target=dar_baixa) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    db.session.expire_all()
    produto = db.session.get(Produto, produto_id)
    saldo = servico.estoque_atual(produto)
    saiu = sum(m.quantidade for m in produto.movimentos
               if m.tipo.value == "saida")

    assert saldo >= 0
    assert saldo + saiu == Decimal("10")   # nada apareceu nem sumiu do nada


# --------------------------------------------------------------------------
# Autorizacao e travas de conta
# --------------------------------------------------------------------------

def test_api_nao_da_baixa_em_produto_fora_de_linha(app, client, dono):
    produto = criar_produto("Arroz 5kg")
    servico.registrar_entrada(produto, 10, dono)
    produto.ativo = False
    db.session.commit()

    entrar(client, "joao")
    resposta = client.post("/api/saida-rapida",
                           json={"produto_id": produto.id, "quantidade": 1})

    assert resposta.get_json()["ok"] is False
    assert servico.estoque_atual(produto) == Decimal("10")


def test_ultimo_dono_nao_pode_se_rebaixar(app, client, dono):
    """Sem essa trava, a loja ficava sem ninguem para administrar."""
    entrar(client, "joao")
    client.post(f"/usuarios/{dono.id}/editar", data={
        "nome": dono.nome, "login": dono.login, "papel": "repositor", "ativo": "sim",
    }, follow_redirects=True)

    assert Usuario.query.filter_by(papel=Papel.ADMIN, ativo=True).count() == 1


def test_ultimo_dono_nao_pode_se_desativar(app, client, dono):
    entrar(client, "joao")
    client.post(f"/usuarios/{dono.id}/editar", data={
        "nome": dono.nome, "login": dono.login, "papel": "admin", "ativo": "nao",
    }, follow_redirects=True)

    assert Usuario.query.filter_by(papel=Papel.ADMIN, ativo=True).count() == 1


def test_dono_pode_sair_quando_ha_outro_no_lugar(app, client, dono):
    """A trava nao pode atrapalhar a troca normal de responsavel."""
    criar_usuario("Dona Maria", "maria", Papel.ADMIN)
    entrar(client, "joao")
    client.post(f"/usuarios/{dono.id}/editar", data={
        "nome": dono.nome, "login": dono.login, "papel": "operador", "ativo": "sim",
    }, follow_redirects=True)

    assert db.session.get(Usuario, dono.id).papel == Papel.OPERADOR


def test_senha_errada_seguidas_vezes_tranca_a_conta(app, client, dono):
    for _ in range(app.config["LOGIN_MAX_TENTATIVAS"]):
        client.post("/entrar", data={"login": "joao", "senha": "chute"})

    resposta = client.post("/entrar", data={"login": "joao", "senha": "123456"},
                           follow_redirects=True)

    assert "Como está o estoque" not in resposta.get_data(as_text=True)
    assert db.session.get(Usuario, dono.id).esta_bloqueado


def test_login_certo_zera_o_contador(app, client, dono):
    client.post("/entrar", data={"login": "joao", "senha": "chute"})
    entrar(client, "joao")

    recarregado = db.session.get(Usuario, dono.id)
    assert recarregado.tentativas_falhas == 0
    assert recarregado.bloqueado_ate is None


# --------------------------------------------------------------------------
# Validade e sessao
# --------------------------------------------------------------------------

def test_mercadoria_ja_vencida_e_recusada_na_entrada(app, client, dono):
    produto = criar_produto("Leite integral 1L", categoria=Categoria.PERECIVEL)
    entrar(client, "joao")
    ontem = (date.today() - timedelta(days=1)).isoformat()

    client.post("/movimentos/entrada", data={
        "produto_id": produto.id, "quantidade": "5", "data_validade": ontem,
    }, follow_redirects=True)

    assert LoteEstoque.query.filter_by(produto_id=produto.id).count() == 0


def test_cookie_de_sessao_e_protegido(app, client, dono):
    resposta = client.post("/entrar", data={"login": "joao", "senha": "123456"})
    cookies = " ".join(resposta.headers.getlist("Set-Cookie"))

    assert "HttpOnly" in cookies
    assert "SameSite" in cookies


def test_producao_recusa_subir_com_a_chave_de_exemplo(app):
    """Com a chave padrao, daria para forjar a sessao do dono."""
    from app import create_app
    from app.config import CHAVE_DE_DESENVOLVIMENTO, Config

    class ConfigDeProducao(Config):
        TESTING = False
        DEBUG = False
        SECRET_KEY = CHAVE_DE_DESENVOLVIMENTO

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(ConfigDeProducao)
