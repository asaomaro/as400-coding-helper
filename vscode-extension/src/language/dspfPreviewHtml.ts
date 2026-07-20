import type {
  DspfDiagnostic,
  DspfLayout,
  DspfPlacedItem
} from "../core/dds/dspfLayout";
import { buildRuler, escapeHtml } from "./ddsPreviewHtmlShared";

/**
 * 画面レイアウト → WebView の HTML。
 *
 * **vscode を import しない**（文字列を返すだけ）。単体テストで桁を検査できる。
 *
 * ■ 桁は計算で決めて箱を固定する（PRTF と同じ考え方）
 *   等幅フォントでも全角がちょうど 2 倍幅になる保証は無い。
 *   **計算した桁が正、表示は箱に収める**（`overflow: hidden`）。
 *
 * ■ 属性文字を描く（DSPF 固有）
 *   属性文字はソースに書かれていないのに画面の桁を消費する。
 *   これを描かないと「なぜ隣に項目を置けないのか」が分からない。
 *   項目の前後 1 桁に淡いマーカーを出す。
 */

export interface DspfPreviewHtmlOptions {
  readonly cspSource: string;
  readonly nonce: string;
  /** 見出しに出すファイル名。 */
  readonly title: string;
  /** ソース側のカーソル行（1 始まり）。該当項目を強調する。 */
  readonly activeSourceLine?: number;
}

export function buildDspfPreviewHtml(
  layout: DspfLayout,
  options: DspfPreviewHtmlOptions
): string {
  const { screen } = layout;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${options.nonce}'; style-src ${options.cspSource} 'unsafe-inline';">
  <title>画面プレビュー - ${escapeHtml(options.title)}</title>
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
    .screen {
      position: relative;
      width: calc(var(--cell) * ${screen.columns});
      height: calc(var(--line-height) * ${screen.rows});
      border: 1px solid var(--vscode-panel-border, #888);
      background: var(--vscode-editor-background, #1e1e1e);
      overflow: hidden;
    }
    .ruler {
      position: relative;
      width: calc(var(--cell) * ${screen.columns});
      white-space: pre;
      opacity: 0.6;
      user-select: none;
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
      border: 1px dashed var(--vscode-editorWarning-foreground, #cca700);
    }
    .item.active { outline: 1px solid var(--vscode-focusBorder, #007acc); }
    .item.movable { cursor: move; }
    .item.dragging { opacity: 0.5; }
    /* 属性文字。ソースに無いが画面の桁を消費するもの。 */
    .attribute {
      position: absolute;
      height: var(--line-height);
      width: var(--cell);
      background: var(--vscode-editorWarning-foreground, #cca700);
      opacity: 0.18;
      pointer-events: none;
    }
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
    .notes, .diagnostics { margin-top: 10px; font-family: sans-serif; font-size: 12px; }
    .notes li, .diagnostics li { margin-bottom: 2px; }
    .notes { opacity: 0.85; }
    .empty { opacity: 0.7; font-family: sans-serif; }
  </style>
</head>
<body>
  <div class="toolbar">
    ${escapeHtml(options.title)} — ${screen.rows} 行 × ${screen.columns} 桁
    ${describeScreenSource(layout)}
  </div>
  <div class="ruler">${escapeHtml(buildRuler(screen.columns))}</div>
  <div class="screen">
    ${layout.items.map(item => renderAttributes(item, screen.columns)).join("\n    ")}
    ${layout.items.map(item => renderItem(item, options.activeSourceLine)).join("\n    ")}
  </div>
  ${renderNotes(layout)}
  ${renderDiagnostics(layout.diagnostics)}
  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();
    const screen = document.querySelector('.screen');

    // 1 桁・1 行の実寸を測る。CSS の calc と同じ値になるよう、
    // 実際に描かれた項目の位置から逆算する（フォント差の影響を受けない）。
    function cellSize() {
      const probe = document.querySelector('.item');
      if (!probe) return { cell: 8, line: 16 };
      const column = Number(probe.dataset.column);
      const row = Number(probe.dataset.row);
      const rect = probe.getBoundingClientRect();
      const base = screen.getBoundingClientRect();
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
        screen.appendChild(hint);
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
      const base = screen.getBoundingClientRect();
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

    screen.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const at = toCell(event);
      const base = screen.getBoundingClientRect();
      // 1 桁目は属性文字のために予約されているので、落とし先の目安として示す。
      const warn = at.column <= 1 ? ' ※1 桁目は属性文字用' : '';
      showHint(event.clientX - base.left + 8, event.clientY - base.top + 8,
        at.row + ' 行 ' + at.column + ' 桁' + warn);
    });

    screen.addEventListener('dragleave', hideHint);

    screen.addEventListener('drop', event => {
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

function describeScreenSource(layout: DspfLayout): string {
  if (!layout.sizes.declared) return "（DSPSIZ 省略のため既定の 24×80）";
  const name = layout.sizes.primary.conditionName;
  return name ? `（DSPSIZ の 1 次画面 ${escapeHtml(name)}）` : "（DSPSIZ の 1 次画面）";
}

/**
 * 開始属性文字・終了属性文字のマーカー。
 *
 * 画面の外に出る分は描かない（箱の中だけを描く）。
 */
function renderAttributes(item: DspfPlacedItem, columns: number): string {
  const marks: string[] = [];
  const put = (column: number, label: string): void => {
    if (column < 1 || column > columns) return;
    marks.push(
      `<div class="attribute" style="top: calc(var(--line-height) * ${item.row - 1});` +
        ` left: calc(var(--cell) * ${column - 1});" title="${escapeHtml(label)}"></div>`
    );
  };

  put(item.occupancy.start, "開始属性文字（画面の桁を 1 つ消費します）");
  // 幅不明のときは終端が決まらないので、終了属性文字は描かない。
  if (item.width !== undefined) {
    put(item.occupancy.end, "終了属性文字（次の項目の開始属性文字と共有できます）");
  }
  return marks.join("\n    ");
}

function renderItem(item: DspfPlacedItem, activeSourceLine?: number): string {
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
      : `${label}（${item.row} 行 ${item.column} 桁 / ${item.width} 桁` +
        ` / 属性文字を含め ${item.occupancy.start}-${item.occupancy.end} 桁）`;

  return `<div class="${classes.join(" ")}" data-source-line="${item.sourceLine}"
      data-row="${item.row}" data-column="${item.column}" draggable="true"
      style="top: calc(var(--line-height) * ${item.row - 1}); left: calc(var(--cell) * ${item.column - 1}); width: calc(var(--cell) * ${width});"
      title="${escapeHtml(title)}">${escapeHtml(label)}</div>`;
}

function describeUnknown(item: DspfPlacedItem): string {
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

/**
 * 解決できなかったものを件数で示す。
 *
 * 「描けていないものが描けたように見える」ことを避けるための注記。
 */
function renderNotes(layout: DspfLayout): string {
  const notes: string[] = [];

  const unknownWidth = layout.items.filter(item => item.width === undefined).length;
  if (unknownWidth > 0) {
    notes.push(`幅が分からない項目が ${unknownWidth} 件あります（破線の枠で位置だけ示しています）`);
  }

  const relative = layout.diagnostics.filter(
    diagnostic => diagnostic.code === "relative-position-unresolved"
  ).length;
  if (relative > 0) {
    notes.push(`相対桁（+n）の項目が ${relative} 件あり、描画していません`);
  }

  if (layout.sizes.secondary) {
    const { rows, columns } = layout.sizes.secondary.size;
    notes.push(`2 次画面サイズ（${rows}×${columns}）があります。ここでは 1 次画面だけを描いています`);
  }

  notes.push(
    "表示桁数は プログラム桁数 で描いています" +
      "（キーボード・シフトによる拡大は見ていないため、実機より狭く出ることがあります）"
  );

  return `<div class="notes">
    <ul>
      ${notes.map(note => `<li>${escapeHtml(note)}</li>`).join("\n      ")}
    </ul>
  </div>`;
}

function renderDiagnostics(diagnostics: readonly DspfDiagnostic[]): string {
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
