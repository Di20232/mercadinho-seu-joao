"""Envio de alertas pelo bot do Telegram.

Custo zero de API (o Telegram nao cobra pelo bot). Se o token nao estiver
configurado, ou se a internet falhar, o alerta continua valendo dentro do
sistema - o envio e' so um canal a mais, nunca a unica copia da informacao.
"""
import logging

import requests
from flask import current_app

log = logging.getLogger(__name__)

URL = "https://api.telegram.org/bot{token}/sendMessage"


def esta_ligado():
    return bool(current_app.config.get("TELEGRAM_BOT_TOKEN"))


def enviar(chat_id, texto):
    """Tenta mandar a mensagem. Devolve True se conseguiu."""
    token = current_app.config.get("TELEGRAM_BOT_TOKEN")
    if not token or not chat_id:
        return False
    try:
        resposta = requests.post(
            URL.format(token=token),
            json={"chat_id": chat_id, "text": texto, "disable_web_page_preview": True},
            timeout=current_app.config.get("TELEGRAM_TIMEOUT", 5),
        )
        if resposta.ok:
            return True
        log.warning("Telegram recusou a mensagem (%s): %s", resposta.status_code, resposta.text[:200])
    except requests.RequestException as erro:  # rede fora do ar, timeout etc.
        log.warning("Não consegui falar com o Telegram: %s", erro)
    return False
