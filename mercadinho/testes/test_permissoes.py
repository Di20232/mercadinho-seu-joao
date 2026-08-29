"""Cada papel so' faz o que lhe cabe (secao 2 do briefing)."""
from decimal import Decimal

from app.models import Papel, Produto
from conftest import criar_produto, criar_usuario, entrar


def test_repositor_nao_cadastra_produto(app, client, repositora):
    entrar(client, "cida")
    resposta = client.post("/produtos/novo", data={"nome": "Produto novo"},
                           follow_redirects=True)
    assert resposta.status_code == 200
    assert Produto.query.filter_by(nome="Produto novo").first() is None
    assert "do dono da loja" in resposta.get_data(as_text=True)


def test_operador_cadastra_produto(app, client, operador):
    entrar(client, "lucas")
    client.post("/produtos/novo", data={
        "nome": "Cerveja lata 350ml", "categoria": "nao_perecivel", "setor": "Bebidas",
        "unidade_medida": "un", "limite_minimo": "24",
    }, follow_redirects=True)
    assert Produto.query.filter_by(nome="Cerveja lata 350ml").first() is not None


def test_so_o_dono_gerencia_pessoas(app, client, operador):
    entrar(client, "lucas")
    assert client.get("/usuarios/").status_code == 403


def test_dono_gerencia_pessoas(app, client, dono):
    entrar(client, "joao")
    assert client.get("/usuarios/").status_code == 200


def test_repositor_da_baixa_no_estoque(app, client, repositora, dono):
    from app.servicos import estoque as servico
    from app.extensions import db
    produto = criar_produto("Arroz 5kg")
    servico.registrar_entrada(produto, 10, dono)
    db.session.commit()

    entrar(client, "cida")
    client.post("/movimentos/saida", data={"produto_id": produto.id, "quantidade": "2"},
                follow_redirects=True)
    assert servico.estoque_atual(produto) == Decimal("8")


def test_sem_login_vai_para_a_tela_de_entrar(app, client):
    resposta = client.get("/", follow_redirects=True)
    assert "Entrar" in resposta.get_data(as_text=True)
