@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%vscode-extension"

echo === VSIX Build ===
cd /d "%EXT_DIR%"

echo [1/4] npm install...
call npm install
if %errorlevel% neq 0 ( echo ERROR: npm install failed & exit /b 1 )

echo [2/4] vsce の確認...
where vsce >nul 2>&1
if %errorlevel% neq 0 (
    echo   -^> @vscode/vsce をグローバルインストールします...
    call npm install -g @vscode/vsce
    if %errorlevel% neq 0 ( echo ERROR: vsce install failed & exit /b 1 )
)

echo [3/4] TypeScript コンパイル...
call npm run compile
if %errorlevel% neq 0 ( echo ERROR: compile failed & exit /b 1 )

echo [4/4] VSIX パッケージ生成...
call vsce package --out "%SCRIPT_DIR%"
if %errorlevel% neq 0 ( echo ERROR: vsce package failed & exit /b 1 )

echo.
echo 完了: .vsix ファイルが %SCRIPT_DIR% に生成されました。
