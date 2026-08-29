"""Controle de acesso por papel."""
from functools import wraps

from flask import abort, flash, redirect, url_for
from flask_login import current_user


def exige(acao):
    """Bloqueia a rota se o papel do usuario nao permitir a acao."""
    def decorador(funcao):
        @wraps(funcao)
        def envelope(*args, **kwargs):
            if not current_user.is_authenticated:
                return redirect(url_for("auth.entrar"))
            if not current_user.pode(acao):
                flash("Essa parte do sistema é do dono da loja.", "aviso")
                return redirect(url_for("painel.inicio"))
            return funcao(*args, **kwargs)
        return envelope
    return decorador


def somente_admin(funcao):
    @wraps(funcao)
    def envelope(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("auth.entrar"))
        if not current_user.eh_admin:
            abort(403)
        return funcao(*args, **kwargs)
    return envelope
