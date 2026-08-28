/**
 * 画面が描くための形（**描画モデル**）を、定義と状態から作る。
 *
 * ## なぜ独立しているか
 *
 * ここは `vscode` を一切知らない。**同じ関数をホストと WebView の両方が呼ぶ**——
 * ホストは開くときに、WebView は入力のたびに。片方だけが持つと必ず食い違うので、
 * 「見出し・並び・囲み・追加パラメーターの別」を決める場所はここ 1 つにする。
 *
 * 判定（表示 / 必須 / 入力可否 / 検証）は持たない。それは `model.ts` の仕事で、
 * ここは `PrompterState` を**描ける形に整えるだけ**。
 *
 * 元は `binding.ts` が HTML の組み立てと一緒に持っていた。
 */
import type {
  ObjectCandidates,
  ParameterDefinition,
  ParameterDependency,
  ParameterOption,
  PrompterDefinition,
  PromptControlGroup
} from "./types";
import type { PrompterState } from "./model";
import { buildCommandHelpText, buildParameterHelpText } from "./commandHelp";
import { isRepeatableGroup, occurrenceName } from "./occurrences";

export interface SerializableField {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly required: boolean;
  readonly inputType: "text" | "dropdown" | "number" | "group";
  readonly options?: { readonly label: string; readonly value: string }[];
  readonly error?: string;
  readonly hasHelp?: boolean;
  /** 値そのものがコマンドの欄（この欄でさらにプロンプターを開ける）。 */
  readonly commandValued?: boolean;
  /** 件数の接尾辞を付ける前のラベル。組を消したときの番号振り直しに使う。 */
  readonly labelBase?: string;
  /** 同じく囲みの見出しの素の値。 */
  readonly groupLabelBase?: string;
  readonly help?: string;
  readonly maxOccurrences?: number;
  readonly maxLength?: number;
  readonly groupName?: string;
  readonly groupLabel?: string;
  // 初期表示状態と、クライアント側で再評価するための依存規則。
  readonly visible: boolean;
  readonly dependsOn?: readonly ParameterDependency[];
  /** CDML(PMTCTL) 由来の条件表示規則。クライアント側で入力のたび再評価する。 */
  readonly promptControl?: readonly PromptControlGroup[];
  /** この欄が指すオブジェクトの種類。候補一覧の紐付けに使う。 */
  readonly objectKind?: "file" | "program" | "dataArea";
  /** CL 変数(&NAME)を書けるか。入力欄の maxlength に効く。 */
  readonly allowsVariable?: boolean;
  /**
   * 選択肢が「制限」か「候補」か（実機の `Rstd`）。
   *
   * **`false` なら候補にすぎず、一覧に無い値も書ける。** 画面はこれを見て
   * 入力部品を変える——`<select>` は一覧に無い値を打てないため。
   * 該当は 108 欄で、**うち 57 欄は選択肢が 1 つしかない**（`ADDPFM` の `SRCTYPE` は
   * 定義済み値が `*NONE` だけだが、実際に書くのは `RPGLE` など）。
   */
  readonly restricted?: boolean;
  readonly disabled: boolean;
  readonly allowedValues?: readonly string[];
  /** 実機の F4 基本プロンプトに出ない「追加パラメータ」か。 */
  readonly additional?: boolean;
}

export interface SerializablePrompterState {
  readonly keyword: string;
  readonly fields: SerializableField[];
  /**
   * コマンド単位の相関制約（排他 / 相互必須 ＋ CDML の DEP）の違反。
   * 個々の欄に属さないので、まとめて上に出す。
   */
  readonly constraintErrors: readonly string[];
  readonly commandHelp?: string;
  /** ワークスペースのソースから集めたオブジェクト名の候補。 */
  readonly objectCandidates?: ObjectCandidates;
  /** 繰り返し指定の group（最後の一組にだけ「追加」ボタンを出すために使う）。 */
  readonly repeatableGroups?: Record<string, { readonly base: string; readonly max: number }>;
}

/**
 * 繰り返し group の「最後の一組」を求める。ここにだけ追加ボタンを出す。
 * 途中の組に出すと、どこに追加されるのか分からなくなるため。
 */
function buildRepeatableGroups(
  definition: PrompterDefinition,
  state: PrompterState
): Record<string, { base: string; max: number }> {
  const result: Record<string, { base: string; max: number }> = {};

  for (const parameter of definition.parameters) {
    if (!isRepeatableGroup(parameter)) continue;

    const last = state.fields
      .filter(field => leafNamesOf(parameter).has(field.parameter.name))
      .reduce((max, field) => Math.max(max, field.occurrence), 0);

    result[occurrenceName(parameter.name, last)] = {
      base: parameter.name,
      max: parameter.maxOccurrences ?? 1
    };
  }

  return result;
}

function leafNamesOf(parameter: ParameterDefinition): Set<string> {
  return new Set(flattenForConstraints([parameter]).map(leaf => leaf.name));
}

/** 相関制約の判定に使う末端パラメータを集める（group は入れ子になりうる）。 */
function flattenForConstraints(
  parameters: readonly ParameterDefinition[]
): ParameterDefinition[] {
  return parameters.flatMap(parameter =>
    parameter.inputType === "group" && parameter.children?.length
      ? flattenForConstraints(parameter.children)
      : [parameter]
  );
}

export function toSerializableState(
  definition: PrompterDefinition,
  state: PrompterState,
  // ワークスペースのソースから集めたオブジェクト名の候補（省略可）。
  objectCandidates: ObjectCandidates = {}
): SerializablePrompterState {
  const groupInfoByChildName = new Map<
    string,
    { readonly groupName: string; readonly groupLabel: string }
  >();

  // group は入れ子になりうる（例: ALCOBJ.OBJ の要素1が修飾名）。
  // 末端の入力欄はすべて最上位 group に束ね、階層は見出しに連ねて示す。
  const registerGroup = (
    parameters: readonly ParameterDefinition[],
    rootName?: string,
    labelPath: string[] = []
  ): void => {
    for (const parameter of parameters) {
      const isGroup =
        parameter.inputType === "group" &&
        Array.isArray(parameter.children) &&
        parameter.children.length > 0;

      if (isGroup) {
        registerGroup(parameter.children ?? [], rootName ?? parameter.name, [
          ...labelPath,
          parameter.description
        ]);
      } else if (rootName) {
        groupInfoByChildName.set(parameter.name, {
          groupName: rootName,
          groupLabel: labelPath.join(" › ")
        });
      }
    }
  };
  registerGroup(definition.parameters);

  // 追加パラメータ（実機の F10 側）の末端入力欄を集める。
  // basic を持つパラメータが1つも無い定義では折りたたまない（情報が無いだけで
  // 全部が追加なわけではなく、全項目を隠すと何も入力できなくなるため）。
  const hasBasicInfo = definition.parameters.some(p => p.basic);
  const additionalNames = new Set<string>();
  if (hasBasicInfo) {
    for (const parameter of definition.parameters) {
      if (parameter.basic) continue;
      for (const leaf of flattenForConstraints([parameter])) additionalNames.add(leaf.name);
    }
  }

  return {
    keyword: definition.keyword,
    constraintErrors: state.constraintErrors,
    commandHelp: buildCommandHelpText(definition),
    objectCandidates,
    repeatableGroups: buildRepeatableGroups(definition, state),
    // 非表示項目もマークアップ上は出力し、クライアント側で入力値に追従して
    // 表示/必須を切り替える（除外してしまうと条件成立時に入力できなくなる）。
    fields: state.fields.map(field => ({
      name: field.fieldName,
      // 繰り返しの2件目以降は見出しに件数を添えて区別できるようにする。
      label:
        field.occurrence > 0
          ? `${field.parameter.description} (${field.occurrence + 1})`
          : field.parameter.description,
      labelBase: field.parameter.description,
      groupLabelBase: groupInfoByChildName.get(field.parameter.name)?.groupLabel,
      value: field.value,
      // 静的な定義値ではなく dependsOn 評価後の実効必須を UI に渡す。
      required: field.required,
      inputType: field.parameter.inputType,
      options: withCurrentValue(field.parameter.options, field.value),
      error: field.error,
      hasHelp: Boolean(buildParameterHelpText(field.parameter)),
      commandValued: field.parameter.valueKind === "command",
      help: buildParameterHelpText(field.parameter),
      maxOccurrences: field.parameter.maxOccurrences,
      maxLength: field.parameter.attributes?.maxLength,
      groupName: (() => {
        const info = groupInfoByChildName.get(field.parameter.name);
        return info ? occurrenceName(info.groupName, field.occurrence) : undefined;
      })(),
      groupLabel: (() => {
        const info = groupInfoByChildName.get(field.parameter.name);
        if (!info) return undefined;
        return field.occurrence > 0
          ? `${info.groupLabel} (${field.occurrence + 1})`
          : info.groupLabel;
      })(),
      visible: field.visible,
      additional: additionalNames.has(field.parameter.name),
      dependsOn: field.parameter.dependsOn,
      promptControl: field.parameter.promptControl,
      objectKind: field.parameter.objectKind,
      allowsVariable: field.parameter.attributes?.allowsVariable,
      restricted: field.parameter.attributes?.restricted,
      disabled: field.disabled,
      allowedValues: field.allowedValues
    }))
  };
}

/**
 * 選択肢に**いまの値が無ければ足す**。
 *
 * 列挙した値＝制限とは限らない。実機が `Rstd=NO` と言う欄では候補にすぎず、
 * 任意の値を書ける（該当 86 欄。`ADDPFM` の `SRCTYPE` は定義済み値が `*NONE` だけだが
 * `RPGLE` と書ける）。ソースに書かれていた値が選択肢に無いとき、足さないと
 * **選び直しようがなく、確定で静かに消える**——ブラウザの `select` は
 * 一致する選択肢が無ければ先頭を選ぶか無選択になり、どちらでも元の値は失われる。
 *
 * 妥当かどうかはコアの `validate()` が見る（`restricted !== false` なら弾く）。
 * ここは**書かれていたものを画面に出す**ことだけを受け持つ。
 */
function withCurrentValue(
  options: readonly ParameterOption[] | undefined,
  value: string
): ParameterOption[] | undefined {
  if (!options || options.length === 0) return options as ParameterOption[] | undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return [...options];
  if (options.some(option => option.value === value || option.value === trimmed)) {
    return [...options];
  }
  return [{ label: value, value }, ...options];
}

/** 囲み（修飾名・要素リスト）1 つ分。中身は末端の入力欄。 */
export interface GroupBlock {
  readonly kind: "group";
  readonly name: string;
  readonly label: string;
  readonly fields: SerializableField[];
}

/** 画面に並べる単位。単独の入力欄か、囲みか。 */
export type Block =
  | { readonly kind: "field"; readonly field: SerializableField }
  | GroupBlock;

/**
 * 入力欄を**定義の順のまま**「単独の欄」と「囲み」に束ねる。
 *
 * 順序は原典のパラメータ表の順そのもの。以前は囲みのある項目を全部先に出しており、
 * `PARM` では先頭のはずの `KWD` が `SNGVAL` などの後ろに回っていた。
 * 囲みは**最初の子が現れた位置**に置く（後から来た子はその囲みへ入る）。
 */
export function buildBlocks(state: SerializablePrompterState): Block[] {
  const blocks: Block[] = [];
  const groups = new Map<string, GroupBlock>();

  for (const field of state.fields) {
    if (!field.groupName) {
      blocks.push({ kind: "field", field });
      continue;
    }

    const existing = groups.get(field.groupName);
    if (existing) {
      existing.fields.push(field);
      continue;
    }

    const group: GroupBlock = {
      kind: "group",
      name: field.groupName,
      label: field.groupLabel ?? field.groupName,
      fields: [field]
    };
    groups.set(field.groupName, group);
    blocks.push(group);
  }

  return blocks;
}
