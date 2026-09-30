@echo off
rem Motion Studio: starts the Studio GUI inside WSL (Ubuntu) and opens it in your browser.
title Motion Studio
wsl.exe -d Ubuntu -- bash -lic "\"$(wslpath '%~dp0')/studio\" gui open"
