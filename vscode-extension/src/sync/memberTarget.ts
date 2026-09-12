/** IBM i source physical file member の宛先。すべて object name として検証済み。 */
export interface MemberTarget {
  readonly library: string;
  readonly sourceFile: string;
  readonly member: string;
}

const IBM_I_OBJECT_NAME = /^[A-Z$#@][A-Z0-9_$#@]{0,9}$/u;

/**
 * workspace 相対の `src/<LIB>/<SRCFILE>/<MEMBER>.<ext>` を IBM i の source member に解決する。
 *
 * VS Code URI や OS の path module に依存しない。呼出元は URI を workspace 相対パスへ
 * 変換してから渡すため、ここでは区切り文字の正規化と構造／object name の検査だけを担う。
 */
export function resolveMemberTarget(relativePath: string): MemberTarget | undefined {
  const segments = relativePath.replace(/\\/gu, "/").split("/");
  if (segments.length !== 4 || segments[0] !== "src") {
    return undefined;
  }

  const [_, librarySegment, sourceFileSegment, filename] = segments;
  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === filename.length - 1) {
    return undefined;
  }

  const library = librarySegment.toUpperCase();
  const sourceFile = sourceFileSegment.toUpperCase();
  const member = filename.slice(0, extensionIndex).toUpperCase();

  if (
    !IBM_I_OBJECT_NAME.test(library) ||
    !IBM_I_OBJECT_NAME.test(sourceFile) ||
    !IBM_I_OBJECT_NAME.test(member)
  ) {
    return undefined;
  }

  return { library, sourceFile, member };
}
