"""Ponto de entrada para producao (gunicorn wsgi:app)."""
from app import create_app

app = create_app()
