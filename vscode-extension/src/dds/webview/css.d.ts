// WebView のスタイルはエントリから import して esbuild に束ねさせる（出力は dist/webview/main.css）。
// tsc から見ると .css は型を持たないモジュールなので、ここで宣言だけしておく。
declare module "*.css";
