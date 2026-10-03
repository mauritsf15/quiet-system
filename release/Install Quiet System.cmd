@echo off
title Quiet System Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install Quiet System.ps1"
if errorlevel 1 pause
