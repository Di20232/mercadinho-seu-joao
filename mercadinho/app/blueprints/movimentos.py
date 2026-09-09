"""Entradas, saidas e perdas (Modulos 2 e 3).

As telas sao curtas de proposito: escolher o produto, digitar a quantidade,
confirmar. Nada de conta na cabeca do usuario.
"""
from datetime import date, datetime

from flask import (Blueprint, flash, redirect, render_template, request,
                   url_for)
from flask_login import current_user, login_required

from .. import formulario
from ..extensions import db
from ..models import (Categoria, LoteEstoque, MotivoPerda, Produto,
                      TipoMovimento)
from ..seguranca import exige
from ..servicos import alertas as servico_alertas
from ..servicos import estoque as servico_estoque
from ..servicos import relatorios

bp = Blueprint("movimentos", __name__, url_prefix="/movimentos")


def _produtos_ativos():
    return Produto.query.filter_by(ativo=True).order_by(Produto.nome).all()


def _produto_do_formulario():
    """Produto escolhido no formulario, se existir e ainda estiver a' venda."""
    produto_id = formulario.inteiro(request.form.get("produto_id"))
    if produto_id is None:
        return None
    produto = db.session.get(Produto, produto_id)
    return produto if produto and produto.ativo else None


def _depois_do_movimento(produto):
    db.session.commit()
    # Sempre no dia real: um movimento de estoque de verdade nao pode abrir
    # ou fechar avisos com base no "dia de teste" que o dono esteja olhando.
    servico_alertas.avaliar_produto(produto)
    db.session.commit()


@bp.route("/")
@login_required
def historico():
    tipo = request.args.get("tipo")
    tipo_enum = TipoMovimento(tipo) if tipo in [t.value for t in TipoMovimento] else None
    lista = relatorios.movimentos(limite=150, tipo=tipo_enum)
    return render_template("movimentos/historico.html", movimentos=lista, tipo=tipo)


@bp.route("/entrada", methods=["GET", "POST"])
@login_required
@exige("registrar_entrada")
def entrada():
    produtos = _produtos_ativos()
    if request.method == "POST":
        produto = _produto_do_formulario()
        quantidade = formulario.decimal(request.form.get("quantidade"))
        if not produto or not quantidade or quantidade <= 0:
            flash("Escolha o produto e a quantidade.", "erro")
            return redirect(url_for("movimentos.entrada"))

        validade = (request.form.get("data_validade") or "").strip()
        data_validade = None
        if validade and produto.categoria == Categoria.PERECIVEL:
            try:
                data_validade = datetime.strptime(validade, "%Y-%m-%d").date()
            except ValueError:
                flash("Data de validade inválida.", "erro")
                return redirect(url_for("movimentos.entrada"))
        if produto.categoria == Categoria.PERECIVEL and not data_validade:
            flash("Produto que estraga precisa da data de validade.", "erro")
            return redirect(url_for("movimentos.entrada"))
        if data_validade and data_validade < date.today():
            flash("Essa mercadoria já está vencida. Confira a data de validade.", "erro")
            return redirect(url_for("movimentos.entrada"))

        servico_estoque.registrar_entrada(
            produto, quantidade, current_user, data_validade=data_validade,
            origem_compra=formulario.texto(request.form.get("origem_compra"), 120) or None,
            custo_unitario=formulario.dinheiro(request.form.get("custo_unitario")),
        )
        _depois_do_movimento(produto)
        flash(f"Chegou {quantidade} {produto.unidade_medida} de {produto.nome}.", "ok")
        return redirect(url_for("movimentos.entrada"))

    return render_template("movimentos/entrada.html", produtos=produtos, hoje=date.today())


@bp.route("/saida", methods=["GET", "POST"])
@login_required
@exige("registrar_saida")
def saida():
    produtos = _produtos_ativos()
    saldos = servico_estoque.estoques_por_produto()
    if request.method == "POST":
        produto = _produto_do_formulario()
        quantidade = formulario.decimal(request.form.get("quantidade"))
        if not produto or not quantidade or quantidade <= 0:
            flash("Escolha o produto e a quantidade.", "erro")
            return redirect(url_for("movimentos.saida"))
        try:
            servico_estoque.registrar_saida(
                produto, quantidade, current_user,
                observacao=formulario.texto(request.form.get("observacao"), 200) or None,
            )
        except servico_estoque.EstoqueInsuficiente as erro:
            db.session.rollback()
            flash(str(erro), "erro")
            return redirect(url_for("movimentos.saida"))
        _depois_do_movimento(produto)
        flash(f"Saiu {quantidade} {produto.unidade_medida} de {produto.nome}.", "ok")
        return redirect(url_for("movimentos.saida"))

    return render_template("movimentos/saida.html", produtos=produtos, saldos=saldos)


@bp.route("/perda", methods=["GET", "POST"])
@login_required
@exige("registrar_perda")
def perda():
    produtos = _produtos_ativos()
    saldos = servico_estoque.estoques_por_produto()
    if request.method == "POST":
        produto = _produto_do_formulario()
        quantidade = formulario.decimal(request.form.get("quantidade"))
        motivo_valor = request.form.get("motivo")
        if not produto or not quantidade or quantidade <= 0 or motivo_valor not in [
                m.value for m in MotivoPerda]:
            flash("Escolha o produto, a quantidade e o motivo.", "erro")
            return redirect(url_for("movimentos.perda"))

        lote = None
        lote_id = formulario.inteiro(request.form.get("lote_id"))
        if lote_id is not None:
            lote = db.session.get(LoteEstoque, lote_id)
            if lote and lote.produto_id != produto.id:
                flash("Esse lote não é desse produto.", "erro")
                return redirect(url_for("movimentos.perda"))
        try:
            servico_estoque.registrar_perda(
                produto, quantidade, current_user, MotivoPerda(motivo_valor), lote=lote,
                observacao=formulario.texto(request.form.get("observacao"), 200) or None,
            )
        except servico_estoque.EstoqueInsuficiente as erro:
            db.session.rollback()
            flash(str(erro), "erro")
            return redirect(url_for("movimentos.perda"))
        _depois_do_movimento(produto)
        flash(f"Perda registrada: {quantidade} {produto.unidade_medida} de {produto.nome}.",
              "ok")
        return redirect(url_for("movimentos.perda"))

    return render_template("movimentos/perda.html", produtos=produtos, saldos=saldos,
                           motivos=list(MotivoPerda))
