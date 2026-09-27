@echo off
rem VSIX を作る。出力はこのスクリプトと同じ場所（リポジトリ直下）。
rem
rem   build-vsix.bat               依存を入れてから作る
rem   build-vsix.bat --no-install
rem
rem vsce は版を固定して npx で呼ぶ（グローバルに入れない）。
rem コンパイル（tsc + WebView の esbuild）は vsce が package.json の vscode:prepublish で行う。
rem 同梱するものは vscode-extension\.vscodeignore で決める。
rem repository と LICENSE が無いと vsce が続行するか聞いて止まるので、聞かずに進める（private リポジトリ）。
setlocal
chcp 65001 >nul

set "VSCE_VERSION=3.9.2"
set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%vscode-extension"
if defined VSIX_OUT_DIR (set "OUT_DIR=%VSIX_OUT_DIR%") else (set "OUT_DIR=%SCRIPT_DIR:~0,-1%")

cd /d "%EXT_DIR%" || exit /b 1
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').name + '-' + require('./package.json').version"`) do set "BASENAME=%%v"
set "VSIX=%OUT_DIR%\%BASENAME%.vsix"

echo === VSIX Build: %BASENAME% ===

if /i "%~1"=="--no-install" (
  echo [1/3] 依存を入れる - 省略（--no-install）
) else (
  echo [1/3] 依存を入れる（npm install）
  call npm install
  if errorlevel 1 ( echo ERROR: npm install に失敗しました & exit /b 1 )
)

echo [2/3] コンパイルとパッケージ（@vscode/vsce@%VSCE_VERSION%）
call npx --yes @vscode/vsce@%VSCE_VERSION% package --out "%VSIX%" --allow-missing-repository --skip-license
if errorlevel 1 ( echo ERROR: vsce package に失敗しました & exit /b 1 )

echo [3/3] 中身の確認
call npx --yes @vscode/vsce@%VSCE_VERSION% ls > "%TEMP%\vsix-files.txt"
if errorlevel 1 ( echo ERROR: 同梱ファイルの一覧を取れませんでした & exit /b 1 )
set "NG="
for %%f in (out/extension/extension.js out/dds-webview/editor.js out/prompter-webview/prompter.js out/sync-webview/sync.js node_modules/ssh2/package.json) do (
  findstr /b /c:"%%f" "%TEMP%\vsix-files.txt" >nul || (echo   NG: %%f が入っていない & set "NG=1")
)
for %%f in (src/ test/ out-test/ dev/ node_modules/playwright-core/) do (
  findstr /b /c:"%%f" "%TEMP%\vsix-files.txt" >nul && (echo   NG: %%f が入っている（.vscodeignore を確認） & set "NG=1")
)
del "%TEMP%\vsix-files.txt" >nul 2>&1
if defined NG exit /b 1

echo.
echo 完了: %VSIX%
endlocal
