"""Cadastro de produtos (Modulo 1)."""
from decimal import Decimal

from flask import (Blueprint, flash, redirect, render_template, request,
                   url_for)
from flask_login import login_required

from .. import data_referencia, formulario
from ..extensions import db
from ..models import Categoria, LoteEstoque, Papel, Produto, Usuario
from ..seguranca import exige
from ..servicos import alertas as servico_alertas
from ..servicos import estoque as servico_estoque

bp = Blueprint("produtos", __name__, url_prefix="/produtos")

SETORES = ["Açougue", "Bebidas", "Frios e laticínios", "Mercearia", "Hortifruti",
           "Limpeza e higiene", "Padaria"]
UNIDADES = ["un", "kg", "L", "pct", "cx", "dz"]

MAX_DIAS_AVISO = 365


@bp.route("/")
@login_required
def listar():
    busca = (request.args.get("busca") or "").strip()
    setor = request.args.get("setor") or None
    consulta = Produto.query
    if busca:
        consulta = consulta.filter(Produto.nome.ilike(f"%{busca}%"))
    if setor:
        consulta = consulta.filter_by(setor=setor)
    produtos = consulta.order_by(Produto.ativo.desc(), Produto.nome).all()
    saldos = servico_estoque.estoques_por_produto()
    setores = [s[0] for s in Produto.query.with_entities(Produto.setor).distinct()
               .order_by(Produto.setor).all()]
    return render_template("produtos/listar.html", produtos=produtos, saldos=saldos,
                           busca=busca, setor=setor, setores=setores)


@bp.route("/novo", methods=["GET", "POST"])
@login_required
@exige("cadastrar_produto")
def novo():
    if request.method == "POST":
        return _salvar(Produto())
    return render_template("produtos/formulario.html", produto=None, setores=SETORES,
                           unidades=UNIDADES, responsaveis=_responsaveis())


@bp.route("/<int:produto_id>/editar", methods=["GET", "POST"])
@login_required
@exige("editar_produto")
def editar(produto_id):
    produto = db.get_or_404(Produto, produto_id)
    if request.method == "POST":
        return _salvar(produto)
    return render_template("produtos/formulario.html", produto=produto, setores=SETORES,
                           unidades=UNIDADES, responsaveis=_responsaveis())


@bp.route("/<int:produto_id>")
@login_required
def detalhe(produto_id):
    produto = db.get_or_404(Produto, produto_id)
    situacao = servico_estoque.situacao_produto(produto, data_referencia())
    lotes = LoteEstoque.query.filter_by(produto_id=produto.id).filter(
        LoteEstoque.quantidade > 0
    ).order_by(LoteEstoque.data_validade.asc().nullslast(),
               LoteEstoque.data_entrada.asc()).all()
    from ..servicos import relatorios
    historico = relatorios.movimentos(limite=40, produto_id=produto.id)
    return render_template("produtos/detalhe.html", produto=produto, situacao=situacao,
                           lotes=lotes, historico=historico)


def _responsaveis():
    return Usuario.query.filter_by(ativo=True).order_by(Usuario.nome).all()


def _salvar(produto):
    nome = formulario.texto(request.form.get("nome"), 120)
    if not nome:
        flash("Escreva o nome do produto.", "erro")
        return redirect(request.url)

    existente = Produto.query.filter(Produto.nome.ilike(nome)).first()
    if existente and existente.id != produto.id:
        flash(f"Já existe um produto chamado {nome}.", "erro")
        return redirect(request.url)

    categoria_valor = request.form.get("categoria") or "nao_perecivel"
    if categoria_valor not in [c.value for c in Categoria]:
        flash("Categoria inválida.", "erro")
        return redirect(request.url)

    # Numeros: o helper ja recusa negativo, NaN, Infinity e valor maior do que
    # a coluna aguenta. Se o usuario digitou algo e nao passou, avisa em vez de
    # gravar um numero errado calado.
    limite = formulario.decimal(request.form.get("limite_minimo"))
    limite_fds = formulario.decimal(request.form.get("limite_minimo_fim_de_semana"))
    for campo, bruto, valor in (
        ("limite mínimo", request.form.get("limite_minimo"), limite),
        ("limite de fim de semana", request.form.get("limite_minimo_fim_de_semana"), limite_fds),
        ("preço de custo", request.form.get("preco_custo"),
         formulario.dinheiro(request.form.get("preco_custo"))),
        ("preço de venda", request.form.get("preco_venda"),
         formulario.dinheiro(request.form.get("preco_venda"))),
    ):
        if formulario.preenchido(bruto) and valor is None:
            flash(f"O {campo} precisa ser um número positivo e dentro do razoável.", "erro")
            return redirect(request.url)
    if limite is None:          # campo em branco: sem limite definido
        limite = Decimal("0")

    responsavel_id = formulario.inteiro(request.form.get("responsavel_padrao_id"))
    if responsavel_id is not None:
        responsavel = db.session.get(Usuario, responsavel_id)
        if not responsavel or not responsavel.ativo:
            flash("Escolha uma pessoa válida para cuidar do produto.", "erro")
            return redirect(request.url)

    dias_aviso = formulario.inteiro(request.form.get("dias_aviso_validade"))
    if dias_aviso is not None and dias_aviso > MAX_DIAS_AVISO:
        dias_aviso = MAX_DIAS_AVISO

    produto.nome = nome
    produto.categoria = Categoria(categoria_valor)
    produto.setor = formulario.texto(request.form.get("setor"), 60, "Mercearia")
    produto.unidade_medida = formulario.texto(request.form.get("unidade_medida"), 10, "un")
    produto.limite_minimo = limite
    produto.limite_minimo_fim_de_semana = limite_fds
    produto.preco_custo = formulario.dinheiro(request.form.get("preco_custo"))
    produto.preco_venda = formulario.dinheiro(request.form.get("preco_venda"))
    produto.dias_aviso_validade = dias_aviso
    produto.responsavel_padrao_id = responsavel_id
    produto.ativo = request.form.get("ativo") != "nao"

    novo_produto = produto.id is None
    db.session.add(produto)
    db.session.commit()

    # Sempre no dia real, nunca no "dia de teste" (ver painel.py)
    servico_alertas.avaliar_produto(produto)
    db.session.commit()

    flash(f"{'Produto cadastrado' if novo_produto else 'Produto atualizado'}: {produto.nome}.",
          "ok")
    return redirect(url_for("produtos.detalhe", produto_id=produto.id))
