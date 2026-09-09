"""Endpoints JSON usados pelo JavaScript das telas (busca e baixa rapida)."""
from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .. import data_referencia, formulario
from ..extensions import db
from ..models import Produto
from ..servicos import alertas as servico_alertas
from ..servicos import estoque as servico_estoque
from ..servicos import regras

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.route("/produtos")
@login_required
def produtos():
    """Busca por nome, para o campo de digitacao das telas de movimento."""
    termo = (request.args.get("busca") or "").strip()
    consulta = Produto.query.filter_by(ativo=True)
    if termo:
        consulta = consulta.filter(Produto.nome.ilike(f"%{termo}%"))
    lista = consulta.order_by(Produto.nome).limit(20).all()
    saldos = servico_estoque.estoques_por_produto()
    return jsonify([
        {
            "id": p.id,
            "nome": p.nome,
            "setor": p.setor,
            "unidade": p.unidade_medida,
            "estoque": regras.formatar_quantidade(saldos.get(p.id, 0)),
            "perecivel": p.eh_perecivel,
        }
        for p in lista
    ])


@bp.route("/situacao")
@login_required
def situacao():
    """Resumo do semaforo, usado para atualizar o painel sem recarregar."""
    itens = servico_estoque.visao_geral(data_referencia())
    return jsonify(servico_estoque.resumo_semaforo(itens))


@bp.route("/saida-rapida", methods=["POST"])
@login_required
def saida_rapida():
    """Botao '-1' do painel: tira uma unidade sem sair da tela."""
    if not current_user.pode("registrar_saida"):
        return jsonify({"ok": False, "erro": "Você não pode dar baixa no estoque."}), 403

    dados = request.get_json(silent=True) or {}
    quantidade = formulario.decimal(str(dados.get("quantidade", "1")))
    if not quantidade or quantidade <= 0:
        return jsonify({"ok": False, "erro": "Quantidade inválida."}), 400

    produto_id = formulario.inteiro(str(dados.get("produto_id", "")))
    produto = db.session.get(Produto, produto_id) if produto_id else None
    if not produto or not produto.ativo:
        return jsonify({"ok": False, "erro": "Produto não encontrado."}), 404

    try:
        servico_estoque.registrar_saida(produto, quantidade, current_user,
                                        observacao="Baixa rápida pelo painel")
    except servico_estoque.EstoqueInsuficiente as erro:
        db.session.rollback()
        return jsonify({"ok": False, "erro": str(erro)}), 400

    db.session.commit()
    servico_alertas.avaliar_produto(produto)  # sempre no dia real
    db.session.commit()

    situacao_atual = servico_estoque.situacao_produto(produto, data_referencia())
    return jsonify({
        "ok": True,
        "produto_id": produto.id,
        "estoque": regras.formatar_quantidade(situacao_atual["estoque"]),
        "status": situacao_atual["status"],
        "cor": situacao_atual["cor"],
        "rotulo": situacao_atual["rotulo"],
        "frase": situacao_atual["frase"],
    })
