// WebView（ブラウザで動くコード）と、単独起動ハーネスを束ねる。
//
// 拡張ホスト側は従来どおり tsc（`npm run compile`）。ここで esbuild を使うのは、
// **ブラウザ向けに 1 ファイルへ束ねる必要がある**のは WebView だけだから。
// 拡張のビルドの仕組みを丸ごと変えない（既存の作法を壊さない）。
//
// 出力先が out/ の下なのは、VSIX の同梱物が out/ を含むため。
import { build } from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const production = process.argv.includes("--production");
const common = {
  bundle: true,
  // フィクスチャは文字列として埋め込む（単独起動でサンプルをすぐ開けるように）。
  loader: { ".dspf": "text" },
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: !production,
  minify: production,
  logLevel: "info"
};

// 1) VSCode の WebView 用。
await build({
  ...common,
  entryPoints: ["src/dds/webview/main.ts"],
  outfile: "out/dds-webview/editor.js"
});

// 2) 単独起動ハーネス（検証用）。**--production では作らない**——
//    VSIX に検証用の出力を混ぜない（`vscode:prepublish` はこちらを通らない）。
if (!production && existsSync("dev/standalone.ts")) {
  mkdirSync("dev/out", { recursive: true });
  await build({
    ...common,
    entryPoints: ["dev/standalone.ts"],
    outfile: "dev/out/standalone.js"
  });
  copyFileSync("dev/standalone.html", "dev/out/index.html");
  console.log("dev/out/index.html を生成しました");
}
