import type {
  LayoutDiagnostic,
  PlacedItem,
  PrtfLayout
} from "../core/dds/prtfLayout";

/**
 * 帳票レイアウト → WebView の HTML。
 *
 * **vscode を import しない**（文字列を返すだけ）。単体テストで桁を検査できる。
 *
 * ■ 桁は計算で決めて箱を固定する
 *   等幅フォントでも全角がちょうど 2 倍幅になる保証は無く、環境で変わる。
 *   **計算した桁が正、表示は箱に収める**（`overflow: hidden`）。
 *   はみ出したら見た目で分かり、それ自体が「幅が足りない」という情報になる。
 *
 *   位置と幅は `--cell`（1 桁の幅）の整数倍で置く。`ch` は等幅フォントの
 *   `0` の幅なので、半角 1 文字＝1 桁に対応する。
 */

export interface PrtfPreviewHtmlOptions {
  readonly cspSource: string;
  readonly nonce: string;
  /** 見出しに出すファイル名。 */
  readonly title: string;
  /** ソース側のカーソル行（1 始まり）。該当項目を強調する。 */
  readonly activeSourceLine?: number;
}

export function buildPrtfPreviewHtml(
  layout: PrtfLayout,
  options: PrtfPreviewHtmlOptions
): string {
  const { page } = layout;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${options.nonce}'; style-src ${options.cspSource} 'unsafe-inline';">
  <title>帳票プレビュー - ${escapeHtml(options.title)}</title>
  <style>
    :root {
      /* 1 桁の幅。全角はこの 2 倍を占めるものとして桁を計算済み。 */
      --cell: 1ch;
      --line-height: 1.25em;
    }
    body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      padding: 8px;
      margin: 0;
    }
    .toolbar { margin-bottom: 8px; font-family: sans-serif; font-size: 12px; }
    .paper {
      position: relative;
      width: calc(var(--cell) * ${page.columns});
      height: calc(var(--line-height) * ${page.rows});
      border: 1px solid var(--vscode-panel-border, #888);
      background: var(--vscode-editor-background, #1e1e1e);
      overflow: hidden;
    }
    .ruler {
      position: relative;
      width: calc(var(--cell) * ${page.columns});
      white-space: pre;
      opacity: 0.6;
      user-select: none;
    }
    .overflow-line {
      position: absolute;
      left: 0;
      width: 100%;
      border-top: 1px dashed var(--vscode-editorWarning-foreground, #cca700);
      opacity: 0.7;
    }
    .item {
      position: absolute;
      height: var(--line-height);
      line-height: var(--line-height);
      white-space: pre;
      /* 箱が権威。フォントで全角がはみ出しても桁は動かさない。 */
      overflow: hidden;
      box-sizing: border-box;
      cursor: pointer;
    }
    .item.constant { background: var(--vscode-editor-inactiveSelectionBackground, #33384a); }
    .item.field { background: var(--vscode-editor-selectionBackground, #264f78); }
    .item.unknown-width {
      background: transparent;
      border-left: 2px solid var(--vscode-editorWarning-foreground, #cca700);
      padding-left: 2px;
    }
    .item.active { outline: 1px solid var(--vscode-focusBorder, #007acc); }
    .item.movable { cursor: move; }
    .item.dragging { opacity: 0.5; }
    .drop-hint {
      position: absolute;
      font-family: sans-serif;
      font-size: 11px;
      background: var(--vscode-editorHoverWidget-background, #252526);
      border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
      padding: 1px 4px;
      pointer-events: none;
      white-space: nowrap;
    }
    .diagnostics { margin-top: 10px; font-family: sans-serif; font-size: 12px; }
    .diagnostics li { margin-bottom: 2px; }
    .empty { opacity: 0.7; font-family: sans-serif; }
  </style>
</head>
<body>
  <div class="toolbar">
    ${escapeHtml(options.title)} — ${page.rows} 行 × ${page.columns} 桁
    （オーバーフロー行 ${page.overflowLine}）
  </div>
  <div class="ruler">${escapeHtml(buildRuler(page.columns))}</div>
  <div class="paper">
    ${buildOverflowMarker(page.overflowLine, page.rows)}
    ${layout.items.map(item => renderItem(item, options.activeSourceLine)).join("\n    ")}
  </div>
  ${renderDiagnostics(layout.diagnostics)}
  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();
    const paper = document.querySelector('.paper');

    // 1 桁・1 行の実寸を測る。CSS の calc と同じ値になるよう、
    // 実際に描かれた項目の位置から逆算する（フォント差の影響を受けない）。
    function cellSize() {
      const probe = document.querySelector('.item');
      if (!probe) return { cell: 8, line: 16 };
      const column = Number(probe.dataset.column);
      const row = Number(probe.dataset.row);
      const rect = probe.getBoundingClientRect();
      const base = paper.getBoundingClientRect();
      return {
        cell: column > 1 ? (rect.left - base.left) / (column - 1) : rect.width,
        line: row > 1 ? (rect.top - base.top) / (row - 1) : rect.height
      };
    }

    let hint;
    function showHint(x, y, text) {
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'drop-hint';
        paper.appendChild(hint);
      }
      hint.style.left = x + 'px';
      hint.style.top = y + 'px';
      hint.textContent = text;
    }
    function hideHint() {
      hint?.remove();
      hint = undefined;
    }

    /** 落とした位置を桁・行に直す。桁は計算で決める（見た目に合わせない）。 */
    function toCell(event) {
      const base = paper.getBoundingClientRect();
      const { cell, line } = cellSize();
      return {
        row: Math.max(1, Math.round((event.clientY - base.top) / line) + 1),
        column: Math.max(1, Math.round((event.clientX - base.left) / cell) + 1)
      };
    }

    document.querySelectorAll('.item').forEach(element => {
      element.addEventListener('click', () => {
        vscode.postMessage({
          type: 'reveal',
          sourceLine: Number(element.dataset.sourceLine)
        });
      });

      element.addEventListener('dragstart', event => {
        element.classList.add('dragging');
        event.dataTransfer.setData('text/plain', element.dataset.sourceLine);
        event.dataTransfer.effectAllowed = 'move';
      });

      element.addEventListener('dragend', () => {
        element.classList.remove('dragging');
        hideHint();
      });
    });

    paper.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const at = toCell(event);
      const base = paper.getBoundingClientRect();
      showHint(event.clientX - base.left + 8, event.clientY - base.top + 8,
        at.row + ' 行 ' + at.column + ' 桁');
    });

    paper.addEventListener('dragleave', hideHint);

    paper.addEventListener('drop', event => {
      event.preventDefault();
      hideHint();
      const sourceLine = Number(event.dataTransfer.getData('text/plain'));
      if (!sourceLine) return;
      const at = toCell(event);
      vscode.postMessage({ type: 'move', sourceLine, row: at.row, column: at.column });
    });
  </script>
</body>
</html>`;
}

/** 桁の目盛り。`....+....1....+....2` の形（SEU と同じ読み方）。 */
export function buildRuler(columns: number): string {
  let ruler = "";
  for (let column = 1; column <= columns; column += 1) {
    if (column % 10 === 0) {
      ruler += String((column / 10) % 10);
    } else if (column % 5 === 0) {
      ruler += "+";
    } else {
      ruler += ".";
    }
  }
  return ruler;
}

function buildOverflowMarker(overflowLine: number, rows: number): string {
  if (overflowLine < 1 || overflowLine > rows) return "";
  return `<div class="overflow-line" style="top: calc(var(--line-height) * ${overflowLine});" title="オーバーフロー行 ${overflowLine}"></div>`;
}

function renderItem(item: PlacedItem, activeSourceLine?: number): string {
  const classes = ["item", item.kind];
  if (item.width === undefined) classes.push("unknown-width");
  if (activeSourceLine === item.sourceLine) classes.push("active");
  classes.push("movable");

  // 幅不明の項目は、桁が分からないので最小の箱で位置だけ示す。
  const width = item.width ?? 1;
  const label = item.kind === "constant" ? (item.text ?? "") : (item.name ?? "");
  const title =
    item.width === undefined
      ? `${label}（幅不明: ${describeUnknown(item)}）`
      : `${label}（${item.row} 行 ${item.column} 桁 / ${item.width} 桁）`;

  return `<div class="${classes.join(" ")}" data-source-line="${item.sourceLine}"
      data-row="${item.row}" data-column="${item.column}" draggable="true"
      style="top: calc(var(--line-height) * ${item.row - 1}); left: calc(var(--cell) * ${item.column - 1}); width: calc(var(--cell) * ${width});"
      title="${escapeHtml(title)}">${escapeHtml(label)}</div>`;
}

function describeUnknown(item: PlacedItem): string {
  switch (item.widthUnknownReason) {
    case "reference":
      return "REF で参照している（このファイルに桁数が無い）";
    case "user-defined-edit-code":
      return "ユーザー定義の編集コード（実機の *EDTD）";
    case "not-numeric":
      return "数字以外のフィールドに編集コードが付いている";
    default:
      return "桁数が書かれていない";
  }
}

function renderDiagnostics(diagnostics: readonly LayoutDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return '<div class="diagnostics empty">指摘はありません。</div>';
  }
  const rows = diagnostics
    .map(
      diagnostic =>
        `<li>${diagnostic.sourceLine} 行目: ${escapeHtml(diagnostic.message)}</li>`
    )
    .join("\n      ");
  return `<div class="diagnostics">
    <strong>${diagnostics.length} 件の指摘</strong>
    <ul>
      ${rows}
    </ul>
  </div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
