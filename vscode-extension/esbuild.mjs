// 拡張本体と WebView の資産を dist/ へ束ねる。
//
// バンドルする理由は 2 つ:
//   1. npm workspaces の依存（@as400/dds-core）は node_modules 内の symlink になる。
//      vsce はこれをたどってリポジトリ全体を VSIX に取り込もうとして失敗する。
//      バンドルすれば依存はコードに畳まれ、VSIX は --no-dependencies で足りる。
//   2. vsce 自身が「2920 ファイルは多すぎる。bundle せよ」と警告していた（起動性能）。
//
// **WebView 資産の出力先が dist/ なのは必須の理由がある。**
// .vscodeignore が `src/**` と `**/*.ts` を落とすため、src の下に置いたままでは
// 開発機では動くのに VSIX では読み込めない（真っ白になる）。dist/ は VSIX に載る。
//
// "vscode" だけは external。実行時に拡張ホストが供給するモジュールで、束ねてはならない。
import { build } from "esbuild";

const production = process.argv.includes("--production");

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: "info"
};

// 拡張ホスト側（Node）。
await build({
  ...common,
  entryPoints: ["src/extension/extension.ts"],
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18"
});

// WebView 側（ブラウザ）。CSS はエントリからの import を esbuild が dist/webview/main.css に出す。
// **`vscode` を external にしない**——WebView から vscode モジュールは見えないので、
// 万一 import されたらここでビルドが落ちるほうがよい（design の分離を機械で守る）。
await build({
  ...common,
  entryPoints: ["src/dds/webview/main.ts"],
  outfile: "dist/webview/main.js",
  format: "iife",
  platform: "browser",
  target: "es2022"
});
