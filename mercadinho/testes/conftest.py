"""Base dos testes. Usa um banco PostgreSQL separado (TEST_DATABASE_URL)."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app import create_app
from app.config import TestConfig
from app.extensions import db as _db
from app.models import Categoria, Papel, Produto, Usuario
from app.servicos import estoque as servico_estoque

# Datas fixas para os testes nao dependerem do dia em que rodam
SEGUNDA = date(2026, 9, 7)
SEXTA = date(2026, 9, 11)


@pytest.fixture()
def app():
    aplicacao = create_app(TestConfig)
    with aplicacao.app_context():
        _db.drop_all()
        _db.create_all()
        yield aplicacao
        _db.session.remove()
        _db.drop_all()


@pytest.fixture()
def db(app):
    return _db


@pytest.fixture()
def client(app):
    return app.test_client()


def criar_usuario(nome, login, papel, senha="123456", telegram=None):
    usuario = Usuario(nome=nome, login=login, papel=papel, contato_telegram=telegram)
    usuario.definir_senha(senha)
    _db.session.add(usuario)
    _db.session.commit()
    return usuario


def criar_produto(nome, **campos):
    padroes = {
        "categoria": Categoria.NAO_PERECIVEL,
        "setor": "Mercearia",
        "unidade_medida": "un",
        "limite_minimo": Decimal("5"),
    }
    padroes.update(campos)
    produto = Produto(nome=nome, **padroes)
    _db.session.add(produto)
    _db.session.commit()
    return produto


@pytest.fixture()
def dono(app):
    return criar_usuario("Seu João", "joao", Papel.ADMIN)


@pytest.fixture()
def operador(app):
    return criar_usuario("Lucas", "lucas", Papel.OPERADOR)


@pytest.fixture()
def repositora(app):
    return criar_usuario("Cida", "cida", Papel.REPOSITOR)


def entrar(client, login, senha="123456"):
    return client.post("/entrar", data={"login": login, "senha": senha},
                       follow_redirects=True)
