@echo off
title Eugea
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des dependances, une seule fois...
  call npm install --no-fund --no-audit
)
echo Eugea s'ouvre dans le navigateur. Fermez cette fenetre pour l'arreter.
call npm run dev
