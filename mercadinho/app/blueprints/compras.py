"""Lista de compras sugerida (Modulo 2)."""
from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import login_required

from .. import data_referencia
from ..extensions import db
from ..models import ListaCompraSugerida
from ..seguranca import exige
from ..servicos import compras as servico_compras

bp = Blueprint("compras", __name__, url_prefix="/compras")


@bp.route("/")
@login_required
def listar():
    dia = data_referencia()
    lista = servico_compras.lista_do_dia(dia)
    if not lista:
        lista = servico_compras.gerar_lista(dia)
    return render_template("compras/listar.html", lista=lista, dia=dia)


@bp.route("/gerar", methods=["POST"])
@login_required
@exige("gerar_lista_compras")
def gerar():
    lista = servico_compras.gerar_lista(data_referencia())
    flash(f"Lista atualizada: {len(lista)} produto(s) para comprar.", "ok")
    return redirect(url_for("compras.listar"))


@bp.route("/<int:item_id>/comprado", methods=["POST"])
@login_required
@exige("ver_painel")
def marcar_comprado(item_id):
    item = db.get_or_404(ListaCompraSugerida, item_id)
    item.comprado = not item.comprado
    db.session.commit()
    return redirect(request.referrer or url_for("compras.listar"))
