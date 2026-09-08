"""Cadastro de usuarios e feriados (so o dono mexe)."""
from datetime import datetime

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from ..extensions import db
from ..models import DiaEspecial, Papel, Usuario
from ..seguranca import somente_admin

bp = Blueprint("usuarios", __name__, url_prefix="/usuarios")


@bp.route("/")
@login_required
@somente_admin
def listar():
    usuarios = Usuario.query.order_by(Usuario.ativo.desc(), Usuario.nome).all()
    feriados = DiaEspecial.query.order_by(DiaEspecial.data).all()
    return render_template("usuarios/listar.html", usuarios=usuarios, papeis=list(Papel),
                           feriados=feriados)


@bp.route("/novo", methods=["GET", "POST"])
@login_required
@somente_admin
def novo():
    if request.method == "POST":
        return _salvar(Usuario())
    return render_template("usuarios/formulario.html", usuario=None, papeis=list(Papel))


@bp.route("/<int:usuario_id>/editar", methods=["GET", "POST"])
@login_required
@somente_admin
def editar(usuario_id):
    usuario = db.get_or_404(Usuario, usuario_id)
    if request.method == "POST":
        return _salvar(usuario)
    return render_template("usuarios/formulario.html", usuario=usuario, papeis=list(Papel))


def _salvar(usuario):
    nome = (request.form.get("nome") or "").strip()
    login = (request.form.get("login") or "").strip().lower()
    senha = request.form.get("senha") or ""
    if not nome or not login:
        flash("Preencha nome e usuário.", "erro")
        return redirect(request.url)

    existente = Usuario.query.filter_by(login=login).first()
    if existente and existente.id != usuario.id:
        flash(f"Já existe alguém usando o login '{login}'.", "erro")
        return redirect(request.url)
    if usuario.id is None and not senha:
        flash("Defina uma senha para a pessoa entrar.", "erro")
        return redirect(request.url)

    papel_valor = request.form.get("papel") or "repositor"
    if papel_valor not in [p.value for p in Papel]:
        flash("Papel inválido.", "erro")
        return redirect(request.url)

    usuario.nome = nome
    usuario.login = login
    usuario.papel = Papel(papel_valor)
    usuario.contato_telegram = (request.form.get("contato_telegram") or "").strip() or None
    usuario.ativo = request.form.get("ativo") != "nao"
    if senha:
        usuario.definir_senha(senha)

    db.session.add(usuario)
    db.session.commit()
    flash(f"Usuário {usuario.nome} salvo.", "ok")
    return redirect(url_for("usuarios.listar"))


@bp.route("/feriados", methods=["POST"])
@login_required
@somente_admin
def novo_feriado():
    valor = (request.form.get("data") or "").strip()
    descricao = (request.form.get("descricao") or "").strip()
    try:
        dia = datetime.strptime(valor, "%Y-%m-%d").date()
    except ValueError:
        flash("Data inválida.", "erro")
        return redirect(url_for("usuarios.listar"))
    if not descricao:
        flash("Escreva o nome da data (ex.: Natal).", "erro")
        return redirect(url_for("usuarios.listar"))
    if DiaEspecial.query.filter_by(data=dia).first():
        flash("Essa data já está cadastrada.", "aviso")
        return redirect(url_for("usuarios.listar"))
    db.session.add(DiaEspecial(data=dia, descricao=descricao))
    db.session.commit()
    flash("Data especial cadastrada. Na véspera o limite mínimo já sobe.", "ok")
    return redirect(url_for("usuarios.listar"))


@bp.route("/feriados/<int:feriado_id>/apagar", methods=["POST"])
@login_required
@somente_admin
def apagar_feriado(feriado_id):
    feriado = db.get_or_404(DiaEspecial, feriado_id)
    db.session.delete(feriado)
    db.session.commit()
    flash("Data removida.", "ok")
    return redirect(url_for("usuarios.listar"))
