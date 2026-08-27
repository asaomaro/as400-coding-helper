// 検証用ハーネスの型宣言。フィクスチャは esbuild の text ローダで文字列として取り込む。
declare module "*.dspf" {
  const content: string;
  export default content;
}
declare module "*.prtf" {
  const content: string;
  export default content;
}
declare module "*.css";
