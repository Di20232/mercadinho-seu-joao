"""Configuracao da aplicacao, lida do ambiente (.env)."""
import os

from dotenv import load_dotenv

load_dotenv()


def _bool(nome, padrao=False):
    valor = os.getenv(nome)
    if valor is None:
        return padrao
    return valor.strip().lower() in ("1", "true", "sim", "yes", "on")


def _int(nome, padrao):
    try:
        return int(os.getenv(nome, padrao))
    except (TypeError, ValueError):
        return padrao


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-mercadinho-seu-joao")

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://postgres:postgres@localhost:5432/mercadinho",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    # Regras de negocio parametrizaveis (ver README)
    DIAS_AVISO_VALIDADE = _int("DIAS_AVISO_VALIDADE", 3)
    DIAS_PERECIVEL_PARADO = _int("DIAS_PERECIVEL_PARADO", 2)
    DIAS_COBERTURA_COMPRA = _int("DIAS_COBERTURA_COMPRA", 3)
    DIAS_MEDIA_CONSUMO = _int("DIAS_MEDIA_CONSUMO", 14)

    # Canal de alerta
    TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    TELEGRAM_TIMEOUT = _int("TELEGRAM_TIMEOUT", 5)
    ALERTA_COPIA_ADMIN = _bool("ALERTA_COPIA_ADMIN", True)

    # Usuario administrador inicial
    ADMIN_LOGIN = os.getenv("ADMIN_LOGIN", "joao")
    ADMIN_SENHA = os.getenv("ADMIN_SENHA", "trocar123")
    ADMIN_NOME = os.getenv("ADMIN_NOME", "Seu Joao")


class TestConfig(Config):
    TESTING = True
    WTF_CSRF_ENABLED = False
    SECRET_KEY = "teste"
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "TEST_DATABASE_URL",
        "postgresql+psycopg2://postgres:postgres@localhost:5432/mercadinho_test",
    )
    TELEGRAM_BOT_TOKEN = ""
