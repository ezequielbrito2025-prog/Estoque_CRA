@echo off
chcp 65001 >nul
title Contagem de Inventario - Servidor
cd /d "%~dp0"

REM ================================================================
REM  SENHAS DE ACESSO (opcional)
REM  Preencha depois do sinal de = (sem espacos). Deixe em branco
REM  para usar sem senha, apenas na rede interna da empresa.
REM ================================================================
set SENHA_EQUIPE=
set SENHA_GESTOR=

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado neste computador.
  echo  Baixe e instale a versao LTS em: https://nodejs.org
  echo  Depois, de dois cliques neste arquivo novamente.
  echo.
  pause
  exit /b
)
node server.js
pause
