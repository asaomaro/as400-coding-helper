// スタイルはエントリから import して esbuild に束ねさせる（出力は同名の .css）。
// tsc から見ると .css は型を持たないモジュールなので、宣言だけしておく。
declare module "*.css";
