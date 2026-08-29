"""Movimentacao de estoque: entrada, saida, perda e o saldo automatico."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.models import MotivoPerda, MovimentoEstoque, TipoMovimento
from app.servicos import estoque as servico
from conftest import criar_produto


def test_entrada_cria_lote_e_soma_no_estoque(app, dono):
    produto = criar_produto("Arroz 5kg")
    servico.registrar_entrada(produto, 10, dono, origem_compra="Atacadão")
    app.extensions["sqlalchemy"].session.commit()

    assert servico.estoque_atual(produto) == Decimal("10")
    assert len(produto.lotes) == 1
    assert produto.lotes[0].origem_compra == "Atacadão"


def test_saida_consome_primeiro_o_lote_que_vence_antes(app, dono):
    """FEFO: empurra pra frente o que esta' mais perto de vencer."""
    from app.models import Categoria
    produto = criar_produto("Leite integral 1L", categoria=Categoria.PERECIVEL)
    hoje = date.today()
    servico.registrar_entrada(produto, 6, dono, data_validade=hoje + timedelta(days=10))
    servico.registrar_entrada(produto, 6, dono, data_validade=hoje + timedelta(days=2))
    app.extensions["sqlalchemy"].session.commit()

    servico.registrar_saida(produto, 4, dono)
    app.extensions["sqlalchemy"].session.commit()

    lote_curto = [l for l in produto.lotes if l.data_validade == hoje + timedelta(days=2)][0]
    lote_longo = [l for l in produto.lotes if l.data_validade == hoje + timedelta(days=10)][0]
    assert lote_curto.quantidade == Decimal("2")   # saiu deste
    assert lote_longo.quantidade == Decimal("6")   # este ficou intacto
    assert servico.estoque_atual(produto) == Decimal("8")


def test_saida_maior_que_o_estoque_nao_passa(app, dono):
    produto = criar_produto("Feijão 1kg")
    servico.registrar_entrada(produto, 3, dono)
    app.extensions["sqlalchemy"].session.commit()

    with pytest.raises(servico.EstoqueInsuficiente):
        servico.registrar_saida(produto, 5, dono)


def test_perda_guarda_motivo_e_valor(app, dono):
    produto = criar_produto("Tomate", preco_custo=Decimal("4.50"))
    servico.registrar_entrada(produto, 10, dono)
    app.extensions["sqlalchemy"].session.commit()

    servico.registrar_perda(produto, 2, dono, MotivoPerda.ESTRAGADO)
    app.extensions["sqlalchemy"].session.commit()

    perda = MovimentoEstoque.query.filter_by(tipo=TipoMovimento.PERDA).one()
    assert perda.motivo == MotivoPerda.ESTRAGADO
    assert perda.valor_estimado == Decimal("9.00")   # 2 x R$ 4,50
    assert servico.estoque_atual(produto) == Decimal("8")


def test_produto_nao_perecivel_ignora_validade(app, dono):
    produto = criar_produto("Detergente")
    lote = servico.registrar_entrada(produto, 5, dono,
                                     data_validade=date.today() + timedelta(days=30))
    app.extensions["sqlalchemy"].session.commit()
    assert lote.data_validade is None
