"""Entradas, saidas e perdas de estoque.

O saldo de um produto e' sempre a soma dos lotes que ainda tem quantidade.
As saidas consomem primeiro o lote que vence antes (FEFO), que e' o que o
Seu Joao faz na pratica: empurra pra frente o que ta' vencendo.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models import (Categoria, LoteEstoque, MovimentoEstoque, Produto,
                      TipoMovimento)
from . import regras

ZERO = Decimal("0")


class EstoqueInsuficiente(Exception):
    """Tentaram tirar mais do que tem no estoque."""

    def __init__(self, produto, pedido, disponivel):
        self.produto = produto
        self.pedido = pedido
        self.disponivel = disponivel
        super().__init__(
            f"Só tem {regras.formatar_quantidade(disponivel)} {produto.unidade_medida} "
            f"de {produto.nome} no estoque."
        )


def _dec(valor):
    return Decimal(str(valor))


def estoque_atual(produto):
    total = db.session.query(func.coalesce(func.sum(LoteEstoque.quantidade), 0)).filter(
        LoteEstoque.produto_id == produto.id
    ).scalar()
    return _dec(total or 0)


def estoques_por_produto():
    """{produto_id: saldo} numa consulta so."""
    linhas = db.session.query(
        LoteEstoque.produto_id, func.coalesce(func.sum(LoteEstoque.quantidade), 0)
    ).group_by(LoteEstoque.produto_id).all()
    return {pid: _dec(total) for pid, total in linhas}


def registrar_entrada(produto, quantidade, usuario, data_validade=None,
                      origem_compra=None, custo_unitario=None, data_entrada=None,
                      observacao=None):
    """Chegou mercadoria: cria um lote novo e registra o movimento."""
    quantidade = _dec(quantidade)
    if quantidade <= ZERO:
        raise ValueError("A quantidade precisa ser maior que zero.")
    if produto.categoria == Categoria.NAO_PERECIVEL:
        data_validade = None

    lote = LoteEstoque(
        produto=produto,
        quantidade=quantidade,
        quantidade_inicial=quantidade,
        data_entrada=data_entrada or date.today(),
        data_validade=data_validade,
        origem_compra=origem_compra,
        custo_unitario=custo_unitario if custo_unitario is not None else produto.preco_custo,
    )
    db.session.add(lote)
    db.session.flush()

    movimento = MovimentoEstoque(
        produto=produto, lote=lote, tipo=TipoMovimento.ENTRADA, quantidade=quantidade,
        usuario_id=usuario.id, observacao=observacao,
        data_hora=datetime.combine(lote.data_entrada, datetime.min.time().replace(hour=9))
        if data_entrada else datetime.utcnow(),
    )
    db.session.add(movimento)
    return lote


def _lotes_para_consumo(produto, priorizar_vencidos=True):
    """Lotes com saldo, do que vence antes para o que vence depois."""
    consulta = LoteEstoque.query.filter(
        LoteEstoque.produto_id == produto.id, LoteEstoque.quantidade > 0
    )
    if priorizar_vencidos:
        ordem = (LoteEstoque.data_validade.asc().nullslast(), LoteEstoque.data_entrada.asc(),
                 LoteEstoque.id.asc())
    else:
        ordem = (LoteEstoque.data_entrada.asc(), LoteEstoque.id.asc())
    return consulta.order_by(*ordem).all()


def _baixar_dos_lotes(produto, quantidade, lote_preferido=None):
    """Tira a quantidade dos lotes e devolve [(lote, quantidade_tirada), ...]."""
    restante = _dec(quantidade)
    disponivel = estoque_atual(produto)
    if restante > disponivel:
        raise EstoqueInsuficiente(produto, restante, disponivel)

    lotes = _lotes_para_consumo(produto)
    if lote_preferido is not None:
        lotes = [lote_preferido] + [l for l in lotes if l.id != lote_preferido.id]

    baixas = []
    for lote in lotes:
        if restante <= ZERO:
            break
        saldo = _dec(lote.quantidade)
        if saldo <= ZERO:
            continue
        usado = saldo if saldo <= restante else restante
        lote.quantidade = saldo - usado
        restante -= usado
        baixas.append((lote, usado))
    if restante > ZERO:  # nao deve acontecer, mas nao deixa passar em silencio
        raise EstoqueInsuficiente(produto, quantidade, disponivel)
    return baixas


def registrar_saida(produto, quantidade, usuario, observacao=None, quando=None):
    """Saiu do estoque (venda no balcao ou baixa manual)."""
    quantidade = _dec(quantidade)
    if quantidade <= ZERO:
        raise ValueError("A quantidade precisa ser maior que zero.")

    movimentos = []
    for lote, usado in _baixar_dos_lotes(produto, quantidade):
        movimento = MovimentoEstoque(
            produto=produto, lote=lote, tipo=TipoMovimento.SAIDA, quantidade=usado,
            usuario_id=usuario.id, observacao=observacao,
            data_hora=quando or datetime.utcnow(),
        )
        db.session.add(movimento)
        movimentos.append(movimento)
    return movimentos


def registrar_perda(produto, quantidade, usuario, motivo, lote=None, observacao=None,
                    quando=None):
    """Perdeu mercadoria (venceu, estragou ou quebrou)."""
    quantidade = _dec(quantidade)
    if quantidade <= ZERO:
        raise ValueError("A quantidade precisa ser maior que zero.")

    movimentos = []
    for lote_baixado, usado in _baixar_dos_lotes(produto, quantidade, lote_preferido=lote):
        custo = lote_baixado.custo_unitario or produto.preco_custo or produto.preco_venda or ZERO
        movimento = MovimentoEstoque(
            produto=produto, lote=lote_baixado, tipo=TipoMovimento.PERDA, quantidade=usado,
            usuario_id=usuario.id, motivo=motivo, observacao=observacao,
            valor_estimado=(_dec(custo) * usado).quantize(Decimal("0.01")),
            data_hora=quando or datetime.utcnow(),
        )
        db.session.add(movimento)
        movimentos.append(movimento)
    return movimentos


def consumo_medio_diario(produto, dias=None, ate=None):
    """Media de saidas por dia nos ultimos dias (base da lista de compras)."""
    from flask import current_app
    dias = dias or current_app.config.get("DIAS_MEDIA_CONSUMO", 14)
    ate = ate or date.today()
    # De ate-(dias-1) ate ate, inclusive dos dois lados: exatamente "dias"
    # dias no total, para bater com a divisao por "dias" logo abaixo.
    inicio = datetime.combine(ate - timedelta(days=dias - 1), datetime.min.time())
    fim = datetime.combine(ate, datetime.max.time())
    total = db.session.query(func.coalesce(func.sum(MovimentoEstoque.quantidade), 0)).filter(
        MovimentoEstoque.produto_id == produto.id,
        MovimentoEstoque.tipo == TipoMovimento.SAIDA,
        MovimentoEstoque.data_hora.between(inicio, fim),
    ).scalar()
    return (_dec(total or 0) / Decimal(dias)) if dias else ZERO


def ultima_saida(produto):
    return db.session.query(func.max(MovimentoEstoque.data_hora)).filter(
        MovimentoEstoque.produto_id == produto.id,
        MovimentoEstoque.tipo == TipoMovimento.SAIDA,
    ).scalar()


def dias_parado(produto, dia=None):
    """Ha quantos dias o estoque atual esta' parado (None se nao ha' estoque).

    Conta a partir do que for mais recente entre a ultima venda e a chegada
    do lote mais novo que ainda tem saldo - senao um produto que acabou de
    ser reposto herdava os dias parados da venda antiga do lote anterior e
    disparava aviso de risco de perda na hora que a mercadoria chegava.
    """
    dia = dia or date.today()
    ultima_entrada_com_saldo = db.session.query(func.max(LoteEstoque.data_entrada)).filter(
        LoteEstoque.produto_id == produto.id, LoteEstoque.quantidade > 0
    ).scalar()
    if not ultima_entrada_com_saldo:
        return None
    ultima = ultima_saida(produto)
    referencia = max(ultima.date(), ultima_entrada_com_saldo) if ultima else ultima_entrada_com_saldo
    return max((dia - referencia).days, 0)


def situacao_produto(produto, dia=None, feriados=None, saldo=None):
    """Tudo que o painel precisa mostrar de um produto, ja mastigado."""
    dia = dia or date.today()
    saldo = estoque_atual(produto) if saldo is None else _dec(saldo)
    limite = regras.limite_do_dia(produto, dia, feriados)
    dias_aviso = regras.dias_aviso_validade(produto)

    lotes = [l for l in produto.lotes if _dec(l.quantidade) > ZERO]
    status_estoque = regras.semaforo_estoque(saldo, limite)
    status_validade = regras.semaforo_validade(lotes, dia, dias_aviso)

    lote_critico = None
    for lote in lotes:
        if lote.data_validade and (not lote_critico or lote.data_validade < lote_critico.data_validade):
            lote_critico = lote
    faltam = lote_critico.dias_para_vencer(dia) if lote_critico else None

    parado = dias_parado(produto, dia)
    from flask import current_app
    limite_parado = current_app.config.get("DIAS_PERECIVEL_PARADO", 2)
    risco_parado = bool(
        produto.eh_perecivel and saldo > ZERO and parado is not None and parado >= limite_parado
    )

    status = regras.pior(status_estoque, status_validade)
    if risco_parado:
        status = regras.pior(status, regras.ATENCAO)

    return {
        "produto": produto,
        "estoque": saldo,
        "limite": limite,
        "limite_padrao": _dec(produto.limite_minimo or 0),
        "dia_de_pico": regras.eh_dia_de_pico(dia, feriados),
        "motivo_limite": regras.motivo_do_limite(dia, feriados),
        "status": status,
        "status_estoque": status_estoque,
        "status_validade": status_validade,
        "cor": regras.COR_SEMAFORO[status],
        "rotulo": regras.ROTULO_SEMAFORO[status],
        "frase": regras.frase_estoque(produto, saldo, limite, status_estoque),
        "frase_validade": regras.frase_validade(produto, faltam) if faltam is not None
        and faltam <= dias_aviso else "",
        "lote_critico": lote_critico,
        "dias_para_vencer": faltam,
        "dias_parado": parado,
        "risco_parado": risco_parado,
        "responsavel": produto.responsavel_padrao,
        "falta_comprar": max(limite - saldo, ZERO),
    }


def visao_geral(dia=None, setor=None, apenas_problemas=False):
    """Situacao de todos os produtos ativos, ordenada do pior para o melhor."""
    from ..models import DiaEspecial
    dia = dia or date.today()
    feriados = {
        linha.data for linha in DiaEspecial.query.filter(
            DiaEspecial.data.between(dia, dia + timedelta(days=1))
        ).all()
    }

    consulta = Produto.query.options(joinedload(Produto.lotes),
                                     joinedload(Produto.responsavel_padrao))
    consulta = consulta.filter(Produto.ativo.is_(True))
    if setor:
        consulta = consulta.filter(Produto.setor == setor)

    saldos = estoques_por_produto()
    itens = [
        situacao_produto(produto, dia, feriados, saldo=saldos.get(produto.id, ZERO))
        for produto in consulta.order_by(Produto.nome).all()
    ]
    if apenas_problemas:
        itens = [i for i in itens if i["status"] != regras.OK]
    ordem = {regras.CRITICO: 0, regras.ATENCAO: 1, regras.OK: 2}
    itens.sort(key=lambda i: (ordem[i["status"]], i["produto"].nome))
    return itens


def resumo_semaforo(itens):
    return {
        "critico": sum(1 for i in itens if i["status"] == regras.CRITICO),
        "atencao": sum(1 for i in itens if i["status"] == regras.ATENCAO),
        "ok": sum(1 for i in itens if i["status"] == regras.OK),
        "total": len(itens),
    }
