@echo off
setlocal
rem ---------------------------------------------------------------------------
rem  ArtCraft x DSH - Windows installer (cmd.exe / double-click wrapper)
rem
rem  install.ps1 does the work; this exists because many Windows machines ship
rem  with an ExecutionPolicy of Restricted, which refuses to run a .ps1 at all
rem  ("cannot be loaded because running scripts is disabled"). -Bypass applies to
rem  this one invocation only and changes no machine-wide setting.
rem
rem  Usage:  install.cmd [-Profile desktop] [-Crafts gridcraft,wordcraft] [-List]
rem          install.cmd -h        (see every option)
rem ---------------------------------------------------------------------------

set "PS=powershell.exe"
where pwsh.exe >nul 2>nul && set "PS=pwsh.exe"

if /i "%~1"=="-h"        goto :help
if /i "%~1"=="--help"    goto :help
if /i "%~1"=="/?"        goto :help

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %errorlevel%

:help
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "Get-Help '%~dp0install.ps1' -Detailed"
exit /b %errorlevel%
