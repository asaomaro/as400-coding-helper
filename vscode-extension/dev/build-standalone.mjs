// 単独起動ハーネスをビルドする（検証用。VSIX には入れない＝.vscodeignore で dev/ を除外）。
//
// 拡張のバンドル（esbuild.mjs）とは別にしてある。製品のビルド経路に検証用の出力を混ぜないため。
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dev/out", { recursive: true });

await build({
  entryPoints: ["dev/standalone.ts"],
  outfile: "dev/out/standalone.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  // フィクスチャは文字列として埋め込む（サンプルをその場で開けるように）。
  loader: { ".dspf": "text" },
  logLevel: "info"
});

copyFileSync("dev/standalone.html", "dev/out/index.html");
console.log("dev/out/index.html を生成しました");
