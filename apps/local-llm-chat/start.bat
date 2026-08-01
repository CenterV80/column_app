@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=8000"
set "MODEL=qwen2.5:0.5b"

echo ============================================
echo   ローカルLLMチャット
echo ============================================
echo.

rem ---------- Ollama がインストールされているか ----------
where ollama >nul 2>nul
if errorlevel 1 (
    echo [エラー] Ollama が見つかりません。
    echo         https://ollama.com/download からインストールしてください。
    echo.
    pause
    exit /b 1
)

rem ---------- Ollama サーバーが動いているか ----------
curl -s -o nul http://localhost:11434/api/tags
if not errorlevel 1 goto ollama_ready

echo [情報] Ollama サーバーを起動しています...
start "Ollama" /min ollama serve
for /l %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    curl -s -o nul http://localhost:11434/api/tags && goto ollama_ready
)
echo [エラー] Ollama サーバーに接続できませんでした。
echo         別ウィンドウで "ollama serve" を実行してから、もう一度お試しください。
echo.
pause
exit /b 1

:ollama_ready
echo [OK] Ollama サーバー稼働中

rem ---------- モデルが入っているか ----------
ollama list | findstr /i /c:"%MODEL%" >nul
if not errorlevel 1 goto model_ready

echo [情報] モデル %MODEL% をダウンロードします（約400MB、初回のみ）...
ollama pull %MODEL%
if errorlevel 1 (
    echo [エラー] モデルのダウンロードに失敗しました。
    echo.
    pause
    exit /b 1
)

:model_ready
echo [OK] モデル %MODEL% 準備完了

rem ---------- 静的サーバーのコマンドを決める ----------
set "SERVER_CMD="
where py >nul 2>nul && set "SERVER_CMD=py -m http.server %PORT%"
if not defined SERVER_CMD (
    where python >nul 2>nul && set "SERVER_CMD=python -m http.server %PORT%"
)
if not defined SERVER_CMD (
    where npx >nul 2>nul && set "SERVER_CMD=npx --yes http-server -p %PORT% -c-1"
)

if not defined SERVER_CMD (
    echo [エラー] Python も Node.js も見つかりません。
    echo         https://www.python.org/downloads/ から Python を入れてください。
    echo         ※インストール時に "Add python.exe to PATH" にチェックを入れてください。
    echo.
    pause
    exit /b 1
)

rem ---------- ブラウザを少し遅らせて開く ----------
start "" /min cmd /c "timeout /t 2 /nobreak >nul & explorer http://localhost:%PORT%/"

echo.
echo --------------------------------------------
echo   http://localhost:%PORT%/ で起動します
echo   終了するには、このウィンドウを閉じるか Ctrl+C
echo --------------------------------------------
echo.

%SERVER_CMD%

endlocal
