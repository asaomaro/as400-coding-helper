/** IBM i source physical file member の宛先。すべて object name として検証済み。 */
export interface MemberTarget {
  readonly library: string;
  readonly sourceFile: string;
  readonly member: string;
  /** 元のファイル拡張子（小文字）。SRCTYPE 導出の入力。 */
  readonly extension: string;
  /** ファイル名の最初の `-` より後（拡張子を除く）。区切りが無い、または `-` 直後が空文字列なら undefined。 */
  readonly textDescription?: string;
}

export type ResolveMemberTargetResult =
  | { readonly ok: true; readonly target: MemberTarget }
  /** src/<LIB>/<SRCFILE>/<name>.<ext> の形になっていない、または拡張子が無い。 */
  | { readonly ok: false; readonly reason: "pathShape" }
  /** library / sourceFile / メンバー名（`-` より前）が IBM i object-name 規則に違反する。 */
  | { readonly ok: false; readonly reason: "memberName" }
  /** テキスト記述（`-` より後）が上限を超える。 */
  | { readonly ok: false; readonly reason: "textDescription" };

const IBM_I_OBJECT_NAME = /^[A-Z$#@][A-Z0-9_$#@]{0,9}$/u;
const TEXT_DESCRIPTION_MAX_LENGTH = 50;

/**
 * workspace 相対の `src/<LIB>/<SRCFILE>/<MEMBER>-<テキスト記述>.<ext>` を IBM i の source member に解決する。
 *
 * VS Code URI や OS の path module に依存しない。呼出元は URI を workspace 相対パスへ
 * 変換してから渡すため、ここでは区切り文字の正規化と構造／object name の検査だけを担う。
 *
 * ファイル名は最初の `-`（ハイフン）でメンバー名とテキスト記述に分割する。IBM i の
 * オブジェクト名にハイフンは使えないため、メンバー名側にハイフンが紛れ込むことは無い
 * （既存のアンダースコア入りメンバー名とも衝突しない。decisions.md D7）。
 */
export function resolveMemberTarget(relativePath: string): ResolveMemberTargetResult {
  const segments = relativePath.replace(/\\/gu, "/").split("/");
  if (segments.length !== 4 || segments[0] !== "src") {
    return { ok: false, reason: "pathShape" };
  }

  const [_, librarySegment, sourceFileSegment, filename] = segments;
  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === filename.length - 1) {
    return { ok: false, reason: "pathShape" };
  }

  const library = librarySegment.toUpperCase();
  const sourceFile = sourceFileSegment.toUpperCase();
  const extension = filename.slice(extensionIndex + 1).toLowerCase();
  const nameWithoutExtension = filename.slice(0, extensionIndex);

  const hyphenIndex = nameWithoutExtension.indexOf("-");
  const memberSegment = hyphenIndex === -1 ? nameWithoutExtension : nameWithoutExtension.slice(0, hyphenIndex);
  const textDescriptionRaw = hyphenIndex === -1 ? undefined : nameWithoutExtension.slice(hyphenIndex + 1);
  const textDescription = textDescriptionRaw === undefined || textDescriptionRaw.length === 0
    ? undefined
    : textDescriptionRaw;

  const member = memberSegment.toUpperCase();

  if (
    !IBM_I_OBJECT_NAME.test(library) ||
    !IBM_I_OBJECT_NAME.test(sourceFile) ||
    !IBM_I_OBJECT_NAME.test(member)
  ) {
    return { ok: false, reason: "memberName" };
  }

  if (textDescription !== undefined && textDescription.length > TEXT_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, reason: "textDescription" };
  }

  return { ok: true, target: { library, sourceFile, member, extension, textDescription } };
}

/**
 * 拡張子から IBM i の SRCTYPE を導出する。`TARGET_EXTENSIONS` の全拡張子を対象に、
 * 大文字化するだけの一様な規則とする（特例テーブルは持たない。decisions.md D8）。
 */
export function deriveSourceType(extension: string): string {
  return extension.toUpperCase();
}
