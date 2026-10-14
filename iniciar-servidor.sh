#!/bin/sh
# Senhas de acesso (opcional). Deixe vazio para usar sem senha na rede interna.
export SENHA_EQUIPE=""
export SENHA_GESTOR=""

cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js não está instalado. Instale a versão LTS em https://nodejs.org"
  exit 1
fi
node server.js
