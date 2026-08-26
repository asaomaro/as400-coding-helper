@echo off
setlocal enabledelayedexpansion

REM build-vsix.sh の Windows 版。**挙動を .sh と一致させること**（片方だけ直さない）。
REM npm workspaces 化とバンドル化により、手順は次のとおり:
REM   1) 依存はリポジトリのルートで入れる（拡張ディレクトリで入れても npm は全体を見る）
REM   2) ビルドは dds-core -> dds-cli -> 拡張 の依存順（ルートの build スクリプトが担う）
REM   3) vsce には --no-dependencies が必須。付けないと @as400/dds-core の symlink を
REM      たどってリポジトリ全体を VSIX に取り込もうとして失敗する
REM      （.aidev/works/20260825-dds-visual-editor/01-workspace/decisions.md D1）

set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%vscode-extension"

echo === VSIX Build ===

echo [1/4] npm install（ルートで workspaces 一括）...
cd /d "%SCRIPT_DIR%"
call npm install
if %errorlevel% neq 0 ( echo ERROR: npm install failed & exit /b 1 )

echo [2/4] ビルド（dds-core -^> dds-cli -^> 拡張の依存順）...
call npm run build
if %errorlevel% neq 0 ( echo ERROR: build failed & exit /b 1 )

echo [3/4] vsce の確認...
where vsce >nul 2>&1
if %errorlevel% neq 0 (
    echo   -^> vsce が無いため npx @vscode/vsce を使用します
    set "VSCE=npx --yes @vscode/vsce"
) else (
    set "VSCE=vsce"
)

echo [4/4] VSIX パッケージ生成...
cd /d "%EXT_DIR%"
call %VSCE% package --no-dependencies --out "%SCRIPT_DIR%"
if %errorlevel% neq 0 ( echo ERROR: vsce package failed & exit /b 1 )

echo.
echo 完了: .vsix ファイルが %SCRIPT_DIR% に生成されました。
