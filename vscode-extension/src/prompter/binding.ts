import type {
  ParameterDefinition,
  ParameterDependency,
  PrompterDefinition
} from "./types";
import type { PrompterState } from "./model";
import type { ResolvedPosition } from "./positionResolver";
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
  readonly disabled: boolean;
  readonly allowedValues?: readonly string[];
  /** 実機の F4 基本プロンプトに出ない「追加パラメータ」か。 */
  readonly additional?: boolean;
}

export interface SerializablePrompterState {
  readonly keyword: string;
  readonly positionLine: number;
  readonly positionColumn: number;
  readonly fields: SerializableField[];
  readonly commandHelp?: string;
  readonly constraints?: readonly {
    readonly kind: "exclusive" | "together";
    readonly parameters: readonly string[];
    readonly note?: string;
  }[];
  readonly constraintFields?: Record<
    string,
    { readonly name: string; readonly defaultValue: string }[]
  >;
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

export interface HtmlOptions {
  readonly cspSource: string;
  readonly nonce: string;
}

export function toSerializableState(
  definition: PrompterDefinition,
  state: PrompterState,
  resolved: ResolvedPosition
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
    positionLine: resolved.line,
    positionColumn: resolved.column,
    commandHelp: buildCommandHelpText(definition),
    constraints: definition.constraints,
    repeatableGroups: buildRepeatableGroups(definition, state),
    // 相関制約の「指定した」判定に既定値が要るため、対象パラメータの末端を渡す。
    constraintFields: definition.constraints?.length
      ? Object.fromEntries(
          [...new Set(definition.constraints.flatMap(c => c.parameters))].map(name => {
            const parameter = definition.parameters.find(p => p.name === name);
            const leaves = parameter ? flattenForConstraints([parameter]) : [];
            return [
              name,
              leaves.map(leaf => ({ name: leaf.name, defaultValue: leaf.defaultValue ?? "" }))
            ];
          })
        )
      : undefined,
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
      options: field.parameter.options,
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
      disabled: field.disabled,
      allowedValues: field.allowedValues
    }))
  };
}

export function buildHtml(
  state: SerializablePrompterState,
  options: HtmlOptions
): string {
  // 入力欄は「定義の順」＝原典のパラメータ表の順に出す。
  // 以前はグループを全部先に出してから単独の欄を出していたため、
  // PARM なら先頭のはずの KWD が、囲みのある SNGVAL などの後ろに回っていた。
  type Block =
    | { readonly kind: "field"; readonly field: SerializableField }
    | {
        readonly kind: "group";
        readonly name: string;
        readonly label: string;
        readonly fields: SerializableField[];
      };

  const blocks: Block[] = [];
  const groups = new Map<string, Extract<Block, { kind: "group" }>>();

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

    const group = {
      kind: "group" as const,
      name: field.groupName,
      label: field.groupLabel ?? field.groupName,
      fields: [field]
    };
    groups.set(field.groupName, group);
    blocks.push(group);
  }

  const renderField = (field: SerializableField): string => {
    const controlHtml = buildFieldControlHtml(field);
    const errorHtml = field.error
      ? `<div class="error">${escapeHtml(field.error)}</div>`
      : "";
    const helpIcon = field.hasHelp
      ? `<span class="help-indicator" data-parameter-name="${escapeHtml(
          field.name
        )}" data-help="${escapeHtml(field.help ?? "")}" title="F1 でヘルプを表示">?</span>`
      : "";
    // 値そのものがコマンドの欄（SBMJOB の CMD など）は、そこでさらに
    // プロンプターを開ける。SEU の F4 in F4 に相当する。
    const promptButton = field.commandValued
      ? `<span class="prompt-indicator" data-parameter-name="${escapeHtml(
          field.name
        )}" title="F4 でコマンドのプロンプターを開く">F4</span>`
      : "";

    return `
      <div class="field" data-label-base="${escapeHtml(
        field.labelBase ?? field.label
      )}"${buildFieldRuleAttributes(field)}>
        <label>
          <span class="field-label">${escapeHtml(field.label)}<span class="required-mark">${
            field.required ? " *" : ""
          }</span>${helpIcon}${promptButton}</span>
          ${controlHtml}
        </label>
        ${errorHtml}
      </div>`;
  };

  const fieldsHtml = blocks
    .map(block => {
      if (block.kind === "field") {
        return renderField(block.field);
      }

      const childrenHtml = block.fields.map(renderField).join("\n");

      // 繰り返し指定の group は、最後の一組にだけ「追加」「削除」を出す。
      // 追加しかないと、押し間違えた組を戻せない。
      const repeat = state.repeatableGroups?.[block.name];
      const buttons = repeat
        ? `<button type="button" class="group-add" data-group="${escapeHtml(
            repeat.base
          )}" data-max="${repeat.max}">追加</button>` +
          // 2 組目以降にだけ削除を出す。1 組目は消せない（パラメータ自体が消える）。
          (block.name !== repeat.base
            ? `<button type="button" class="group-remove" data-group="${escapeHtml(
                block.name
              )}">削除</button>`
            : "")
        : "";

      const groupAdditional = block.fields.every(f => f.additional);
      return `
      <fieldset class="field group-field" data-group-name="${escapeHtml(
        block.name
      )}" data-label-base="${escapeHtml(
        block.fields[0]?.groupLabelBase ?? block.label
      )}"${
        groupAdditional ? ' data-additional="true" style="display:none"' : ""
      }>
        <legend>${escapeHtml(block.label)}</legend>
        ${childrenHtml}
        ${buttons}
      </fieldset>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} https:; script-src 'nonce-${options.nonce}'; style-src ${options.cspSource} 'unsafe-inline';">
  <title>F4 プロンプター - ${escapeHtml(state.keyword)}</title>
  <style>
    body { font-family: sans-serif; padding: 8px; }
    .field { margin-bottom: 6px; }
    .field label > span { display: inline-block; min-width: 15em; }
    .required-mark { color: #d97; font-weight: bold; }
    .help-indicator {
      display: inline-block; width: 1.1em; height: 1.1em; line-height: 1.1em;
      text-align: center; border: 1px solid currentColor; border-radius: 50%;
      font-size: 0.8em; vertical-align: middle;
    }
    .error { color: #be1100; font-size: 0.9em; }
    .buttons { margin-top: 12px; }
    .help-indicator { margin-left: 6px; color: #8ab; cursor: pointer; }
    .prompt-indicator {
      margin-left: 6px;
      padding: 0 4px;
      border: 1px solid #8ab;
      border-radius: 3px;
      color: #8ab;
      cursor: pointer;
      font-size: 0.85em;
    }
    .help-overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .help-overlay.visible { display: flex; }
    .help-backdrop {
      position: absolute;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.4);
    }
    .help-dialog {
      position: relative;
      max-width: 480px;
      max-height: 60vh;
      padding: 12px;
      background-color: #1e1e1e;
      color: #f0f0f0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      border-radius: 4px;
      overflow: auto;
      z-index: 1001;
      /* コマンドヘルプは節ごとの改行を保持して表示する。 */
      white-space: pre-wrap;
    }
    .has-error {
      border: 1px solid #be1100;
    }
    .constraint-errors { margin-bottom: 8px; white-space: pre-wrap; }
    .toggle-additional { margin: 8px 0; }
    .group-add { margin-top: 4px; }
    .group-remove { margin-top: 4px; margin-left: 4px; }
    /* ラベルの右に並べる。ブロックのままだと入力欄が次の行へ回る。 */
    .multi-field { display: inline-block; vertical-align: top; }
    .multi-items { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
    .multi-item { display: flex; gap: 4px; }
  </style>
</head>
<body>
  <h2>${escapeHtml(state.keyword)} プロンプター${
    state.commandHelp
      ? `<span class="help-indicator" id="command-help" data-help="${escapeHtml(
          state.commandHelp
        )}" title="コマンドのヘルプを表示">?</span>`
      : ""
  }</h2>
  <div id="help-overlay" class="help-overlay" aria-hidden="true">
    <div class="help-backdrop"></div>
    <div class="help-dialog">
      <div id="help-content"></div>
    </div>
  </div>
  <form id="prompter-form">
    <div id="constraint-errors" class="error constraint-errors" style="display:none"></div>
    ${fieldsHtml}
    ${
      state.fields.some(f => f.additional)
        ? `<button type="button" id="toggle-additional" class="toggle-additional">追加パラメーターを表示 (F10)</button>`
        : ""
    }
    <div class="buttons">
      <button type="submit">OK</button>
      <button type="button" id="cancel">Cancel</button>
    </div>
  </form>
  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();
    const CONSTRAINTS = ${JSON.stringify(state.constraints ?? [])};
    const CONSTRAINT_FIELDS = ${JSON.stringify(state.constraintFields ?? {})};

    function getForm() {
      return document.getElementById('prompter-form');
    }

    function getFocusableElements(form) {
      const elements = Array.prototype.slice.call(
        form.querySelectorAll('button, input[name], select[name], textarea[name]')
      );
      return elements.filter(function (el) {
        return !el.disabled && el.tabIndex !== -1;
      });
    }

    function focusFirstField() {
      const form = getForm();
      if (!form) {
        return;
      }
      const focusable = getFocusableElements(form);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      if (first && typeof first.focus === 'function') {
        first.focus();
      }
    }

    function getHelpOverlay() {
      return document.getElementById('help-overlay');
    }

    function getHelpContent() {
      return document.getElementById('help-content');
    }

    function isHelpVisible() {
      const overlay = getHelpOverlay();
      return !!(overlay && overlay.classList.contains('visible'));
    }

    function showHelp(text) {
      const overlay = getHelpOverlay();
      const content = getHelpContent();
      if (!overlay || !content) {
        return;
      }
      content.textContent = text || "";
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
    }

    function hideHelp() {
      const overlay = getHelpOverlay();
      if (!overlay) {
        return;
      }
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
    }

    function clearFieldError(input) {
      input.classList.remove('has-error');
      input.removeAttribute('title');
      const field = input.closest('.field');
      if (!field) {
        return;
      }
      const errorDiv = field.querySelector('.error');
      if (errorDiv) {
        errorDiv.textContent = "";
      }
    }

    function setFieldError(input, message) {
      input.classList.add('has-error');
      input.setAttribute('title', message);
      const field = input.closest('.field');
      if (!field) {
        return;
      }
      let errorDiv = field.querySelector('.error');
      if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        field.appendChild(errorDiv);
      }
      errorDiv.textContent = message;
    }

    // 現在の入力値を { パラメータ名: 値 } で取得する。
    function collectValues(form) {
      const values = {};
      const inputs = form.querySelectorAll('input[name], select[name], textarea[name]');
      for (const input of inputs) {
        const name = input.getAttribute('name');
        if (name && !(name in values)) {
          values[name] = String(input.value || '');
        }
      }
      return values;
    }

    // dependsOn を現在値で再評価し、表示と必須を更新する。
    // 非表示に変わった項目は値をクリアし、submit 時に混入しないようにする。
    function applyDependencyRules() {
      const form = getForm();
      if (!form) {
        return;
      }
      const values = collectValues(form);
      const fields = form.querySelectorAll('.field[data-field-name]');

      for (const field of fields) {
        const raw = field.getAttribute('data-depends-on');
        if (!raw) {
          continue;
        }

        let rules = [];
        try {
          rules = JSON.parse(raw) || [];
        } catch (e) {
          continue;
        }

        const name = field.getAttribute('data-field-name');
        const current = String(values[name] || '').trim();

        // visibilityRules.ts の dependencyHolds と同じ判定をクライアント側でも行う。
        // 片方だけ更新するとサーバ/クライアントで挙動が食い違うため注意。
        const norm = function (v) { return String(v == null ? '' : v).trim().toUpperCase(); };
        const conditionHolds = function (condition) {
          const actual = norm(values[condition.parameter]);
          if (condition.equalsAny && condition.equalsAny.length > 0) {
            if (!condition.equalsAny.some(function (c) { return norm(c) === actual; })) {
              return false;
            }
          }
          if (condition.notEqualsAny && condition.notEqualsAny.length > 0) {
            if (condition.notEqualsAny.some(function (c) { return norm(c) === actual; })) {
              return false;
            }
          }
          return true;
        };
        const matches = function (rule) {
          if (rule.all && rule.all.length > 0) {
            return rule.all.every(conditionHolds);
          }
          if (!rule.parameter) {
            return false;
          }
          return conditionHolds(rule);
        };

        const byEffect = function (name) {
          return rules.filter(function (r) { return r.effect === name; });
        };
        const visibleRules = byEffect('visible');
        const requiredRules = byEffect('required');
        const disabledRules = byEffect('disabled');
        const allowedRules = byEffect('allowedValues');

        const visible =
          current.length > 0 ||
          visibleRules.length === 0 ||
          visibleRules.some(matches);
        const disabled = disabledRules.some(matches);
        const required =
          !disabled &&
          (requiredRules.length > 0
            ? requiredRules.some(matches)
            : field.getAttribute('data-static-required') === 'true');

        // 成立した allowedValues 規則の積集合が、実際に入力できる値になる。
        let allowed = null;
        const active = allowedRules.filter(matches);
        for (const rule of active) {
          const list = (rule.allowedValues || []).map(function (v) {
            return String(v).trim().toUpperCase();
          });
          allowed = allowed === null
            ? list
            : allowed.filter(function (v) { return list.indexOf(v) !== -1; });
        }

        field.style.display = visible ? '' : 'none';

        const mark = field.querySelector('.required-mark');
        if (mark) {
          mark.textContent = required ? ' *' : '';
        }

        const controls = field.querySelectorAll('input[name], select[name], textarea[name]');
        for (const control of controls) {
          if (required) {
            control.setAttribute('data-required', 'true');
          } else {
            control.removeAttribute('data-required');
          }

          // 入力不可の項目は値を消したうえで操作を封じる。
          control.disabled = disabled;
          if (disabled || !visible) {
            control.value = '';
            clearFieldError(control);
          }

          // 選択肢の絞り込み: 許可されない option を選べなくする。
          if (control.tagName === 'SELECT') {
            for (const option of control.options) {
              const permitted =
                allowed === null ||
                allowed.indexOf(String(option.value).trim().toUpperCase()) !== -1;
              option.disabled = !permitted;
              option.hidden = !permitted;
            }
            const selected = String(control.value || '').trim().toUpperCase();
            if (allowed !== null && selected && allowed.indexOf(selected) === -1) {
              control.value = '';
            }
          } else if (allowed !== null) {
            control.setAttribute('data-allowed-values', allowed.join('|'));
          } else {
            control.removeAttribute('data-allowed-values');
          }
        }
      }
    }

    function validateForm(form) {
      let hasError = false;
      const inputs = form.querySelectorAll('input[name], select[name], textarea[name]');
      for (const input of inputs) {
        const field = input.closest('.field');
        // 非表示の項目（dependsOn で隠れている / 未展開の追加パラメーター）は
        // 検証しない。見えない欄でエラーにすると原因が分からなくなる。
        if (field && field.offsetParent === null && field.style.display === 'none') {
          continue;
        }
        if (field && field.getAttribute('data-additional') === 'true' && !additionalShown) {
          continue;
        }
        const required = input.getAttribute('data-required') === 'true';
        const value = String(input.value || '');
        clearFieldError(input);
        if (required && value.trim().length === 0) {
          hasError = true;
          setFieldError(input, '値の入力が必要です。');
          continue;
        }

        const allowedAttr = input.getAttribute('data-allowed-values');
        if (allowedAttr && value.trim().length > 0) {
          const allowed = allowedAttr.split('|');
          if (allowed.indexOf(value.trim().toUpperCase()) === -1) {
            hasError = true;
            setFieldError(input, '現在の指定では ' + allowed.join(' / ') + ' のみ指定できます。');
          }
        }
      }

      if (!validateConstraints(form)) {
        hasError = true;
      }

      return !hasError;
    }

    // コマンド単位の相関制約（排他 / 相互必須）を検証する。
    function validateConstraints(form) {
      const banner = document.getElementById('constraint-errors');
      const constraints = CONSTRAINTS || [];
      const values = collectValues(form);
      // 「指定した」＝既定値のままではないこと。model.ts の validateConstraints と
      // 同じ判定。片方だけ直すとサーバ/クライアントで挙動が食い違う。
      const isFilled = function (name) {
        const leaves = CONSTRAINT_FIELDS[name];
        if (!leaves || leaves.length === 0) {
          return String(values[name] || '').trim().length > 0;
        }
        return leaves.some(function (leaf) {
          const value = String(values[leaf.name] || '').trim();
          if (value.length === 0) {
            return false;
          }
          return value.toUpperCase() !== String(leaf.defaultValue || '').trim().toUpperCase();
        });
      };
      const messages = [];

      for (const constraint of constraints) {
        const filled = constraint.parameters.filter(isFilled);
        if (constraint.kind === 'exclusive' && filled.length > 1) {
          messages.push(
            constraint.note ||
              constraint.parameters.join(' と ') + ' は同時に指定できません（指定: ' + filled.join(', ') + '）。'
          );
        }
        if (
          constraint.kind === 'together' &&
          filled.length > 0 &&
          filled.length < constraint.parameters.length
        ) {
          const missing = constraint.parameters.filter(function (n) { return !isFilled(n); });
          messages.push(
            constraint.note ||
              constraint.parameters.join(' と ') + ' は一緒に指定する必要があります（未指定: ' + missing.join(', ') + '）。'
          );
        }
      }

      if (banner) {
        banner.textContent = messages.join('\\n');
        banner.style.display = messages.length > 0 ? '' : 'none';
      }
      return messages.length === 0;
    }

    function getMultiFieldNames(form) {
      const names = new Set();
      const multiFields = form.querySelectorAll('.multi-field');
      for (const field of multiFields) {
        const name = field.getAttribute('data-name');
        if (name) {
          names.add(name);
        }
      }
      return names;
    }

    function setupMultiFieldButtons() {
      const form = getForm();
      if (!form) {
        return;
      }

      form.addEventListener('click', function (event) {
        const target = event.target;
        if (!target || typeof target.matches !== 'function') {
          return;
        }

        if (target.matches('.multi-add')) {
          event.preventDefault();

          const name = target.getAttribute('data-name');
          if (!name) {
            return;
          }

          const container = target.closest('.multi-field');
          if (!container) {
            return;
          }

          const itemsRoot = container.querySelector('.multi-items');
          if (!itemsRoot) {
            return;
          }

          const max = parseInt(container.getAttribute('data-max') || '0', 10);
          const existing = itemsRoot.querySelectorAll('.multi-item').length;
          if (max > 0 && existing >= max) {
            return;
          }

          const wrapper = document.createElement('div');
          wrapper.className = 'multi-item';

          const input = document.createElement('input');
          input.type = 'text';
          input.name = name;
          input.className = 'multi-input';

          const template = container.querySelector('input[name=\"' + name + '\"]');
          if (template && template.getAttribute('data-required') === 'true') {
            input.setAttribute('data-required', 'true');
          }

          const removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.className = 'multi-remove';
          removeButton.textContent = '-';
          removeButton.title = 'Remove';

          wrapper.appendChild(input);
          wrapper.appendChild(removeButton);
          itemsRoot.appendChild(wrapper);
          input.focus();
        } else if (target.matches('.multi-remove')) {
          event.preventDefault();

          const item = target.closest('.multi-item');
          const container = target.closest('.multi-field');
          const itemsRoot = container && container.querySelector('.multi-items');
          if (!item || !itemsRoot) {
            return;
          }

          const existing = itemsRoot.querySelectorAll('.multi-item').length;
          if (existing <= 1) {
            return;
          }

          itemsRoot.removeChild(item);
        }
      });
    }

    // 繰り返し指定の group を1組増やす。最後の一組を複製し、
    // 入力欄名の連番（名前#N）を振り直して値を空にする。
    function setupRepeatableGroups() {
      const form = getForm();
      if (!form) {
        return;
      }


    // 繰り返し指定の組は、消したり増やしたりするたびに番号を振り直す。
    // 途中の組を消しても連番が飛ばないようにするため。番号は入力欄の名前
    // （NAME / NAME#2 …）と対応しており、飛ぶと値の対応が崩れる。
    function renumberGroup(base) {
      const boxes = Array.prototype.slice.call(
        form.querySelectorAll('.group-field[data-group-name="' + base + '"], .group-field[data-group-name^="' + base + '#"]')
      );

      boxes.forEach(function (box, index) {
        const suffix = index === 0 ? '' : '#' + (index + 1);
        const shown = index === 0 ? '' : ' (' + (index + 1) + ')';

        box.setAttribute('data-group-name', base + suffix);

        const legend = box.querySelector('legend');
        if (legend) {
          legend.textContent = (box.getAttribute('data-label-base') || legend.textContent) + shown;
        }

        // 入力欄の名前と、見出しの件数表示を振り直す。
        const controls = box.querySelectorAll('input, select, textarea');
        Array.prototype.forEach.call(controls, function (control) {
          const name = control.getAttribute('name');
          if (name) control.setAttribute('name', name.split('#')[0] + suffix);
        });

        const fields = box.querySelectorAll('.field[data-label-base]');
        Array.prototype.forEach.call(fields, function (field) {
          const span = field.querySelector('.field-label');
          if (!span) return;
          const mark = span.querySelector('.required-mark');
          const rest = mark ? mark.outerHTML + span.innerHTML.split(mark.outerHTML)[1] : '';
          span.innerHTML = escapeForDom(field.getAttribute('data-label-base') || '') + shown + rest;
        });

        // 追加は最後の組だけ、削除は 2 組目以降に置く。
        const isLast = index === boxes.length - 1;
        const add = box.querySelector('.group-add');
        const remove = box.querySelector('.group-remove');

        if (add && !isLast) add.remove();
        if (isLast && !add && boxes[0]) {
          const source = boxes[0].querySelector('.group-add');
          if (source) box.appendChild(source);
        }

        if (index === 0 && remove) remove.remove();
        if (index > 0 && !remove) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'group-remove';
          button.textContent = '削除';
          box.appendChild(button);
        }
      });
    }

    function escapeForDom(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

      form.addEventListener('click', function (event) {
        const target = event.target;
        if (!target || typeof target.matches !== 'function' || !target.matches('.group-add')) {
          return;
        }
        event.preventDefault();

        const base = target.getAttribute('data-group');
        const max = parseInt(target.getAttribute('data-max') || '0', 10);
        const fieldset = target.closest('.group-field');
        if (!base || !fieldset) {
          return;
        }

        const existing = form.querySelectorAll('.group-field[data-group-name^="' + base + '"]').length;
        if (max > 0 && existing >= max) {
          return;
        }

        const next = existing + 1; // 追加後の件数（1件目は連番なし）
        const clone = fieldset.cloneNode(true);
        clone.setAttribute('data-group-name', base + '#' + next);

        const legend = clone.querySelector('legend');
        if (legend) {
          legend.textContent = legend.textContent.replace(/\\s*\\(\\d+\\)\\s*$/, '') + ' (' + next + ')';
        }

        for (const field of clone.querySelectorAll('.field[data-field-name]')) {
          const name = field.getAttribute('data-field-name').replace(/#\\d+$/, '');
          const renamed = name + '#' + next;
          field.setAttribute('data-field-name', renamed);

          const label = field.querySelector('label > span');
          if (label) {
            const mark = label.querySelector('.required-mark');
            const help = label.querySelector('.help-indicator');
            const text = (label.childNodes[0] && label.childNodes[0].textContent) || '';
            label.childNodes[0].textContent = text.replace(/\\s*\\(\\d+\\)\\s*$/, '') + ' (' + next + ')';
            if (mark) mark.textContent = '';
            if (help) help.setAttribute('data-parameter-name', renamed);
          }

          for (const control of field.querySelectorAll('[name]')) {
            control.setAttribute('name', renamed);
            control.value = '';
            control.disabled = false;
          }
          const err = field.querySelector('.error');
          if (err) err.textContent = '';
        }

        // 追加ボタンは常に最後の一組だけに置く。
        const oldButton = fieldset.querySelector('.group-add');
        if (oldButton) oldButton.remove();

        // 引き継いだ削除ボタンは番号がずれるので外す。並べ直しは renumberGroup。
        const inherited = clone.querySelector('.group-remove');
        if (inherited) inherited.remove();

        fieldset.parentNode.insertBefore(clone, fieldset.nextSibling);
        renumberGroup(base);
        applyDependencyRules();
      });

      // 追加した組を消す。どの組でも消せる。消したあとは番号を振り直すので、
      // 途中を消しても連番が飛ばない（飛ぶと入力欄の名前と値の対応が崩れる）。
      form.addEventListener('click', function (event) {
        const target = event.target;
        if (!target || typeof target.matches !== 'function' || !target.matches('.group-remove')) {
          return;
        }
        event.preventDefault();

        const fieldset = target.closest('.group-field');
        if (!fieldset || !fieldset.parentNode) {
          return;
        }

        const base = (fieldset.getAttribute('data-group-name') || '').split('#')[0];
        const boxes = form.querySelectorAll(
          '.group-field[data-group-name="' + base + '"], .group-field[data-group-name^="' + base + '#"]'
        );
        if (boxes.length <= 1) {
          return; // 1 組しかないときは消さない（パラメータ自体が無くなる）
        }

        // 追加ボタンを持って消えると増やせなくなるので、先に外に出す。
        const add = fieldset.querySelector('.group-add');
        if (add && boxes[0] !== fieldset) {
          boxes[0].appendChild(add);
        }

        fieldset.remove();
        renumberGroup(base);
        applyDependencyRules();
      });
    }

    // 追加パラメーターの表示/非表示。実機の F4 は基本パラメーターだけを見せ、
    // F10 で追加分を出す。同じ操作感に合わせる。
    let additionalShown = false;
    function setAdditionalVisible(show) {
      additionalShown = show;
      const form = getForm();
      if (!form) {
        return;
      }
      for (const el of form.querySelectorAll('[data-additional="true"]')) {
        el.style.display = show ? '' : 'none';
      }
      const button = document.getElementById('toggle-additional');
      if (button) {
        button.textContent = show
          ? '追加パラメーターを隠す (F10)'
          : '追加パラメーターを表示 (F10)';
      }
      // 表示を変えたら依存関係を評価し直す（隠れていた項目の必須判定を反映）。
      applyDependencyRules();
    }

    const toggleButton = document.getElementById('toggle-additional');
    if (toggleButton) {
      toggleButton.addEventListener('click', function (event) {
        event.preventDefault();
        setAdditionalVisible(!additionalShown);
      });
    }

    // 初期フォーカスと複数項目ボタンのセットアップ
    focusFirstField();
    setupMultiFieldButtons();
    setupRepeatableGroups();

    // 依存関係の初期反映と、以後の入力変更への追従
    applyDependencyRules();
    const dependencyForm = getForm();
    if (dependencyForm) {
      dependencyForm.addEventListener('change', applyDependencyRules);
      dependencyForm.addEventListener('input', applyDependencyRules);
    }

    document.getElementById('prompter-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const form = event.target;
      if (!validateForm(form)) {
        return;
      }
      const formData = new FormData(form);
      const values = {};
      const multiNames = getMultiFieldNames(form);
      for (const pair of formData.entries()) {
        const key = pair[0];
        const value = String(pair[1] ?? '');
        if (multiNames.has(key)) {
          const trimmed = value.trim();
          if (!trimmed) {
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(values, key)) {
            values[key].push(trimmed);
          } else {
            values[key] = [trimmed];
          }
        } else {
          values[key] = value;
        }
      }
      vscode.postMessage({ type: 'submit', values });
    });

    document.getElementById('cancel').addEventListener('click', function () {
      vscode.postMessage({ type: 'cancel' });
    });

    // F1 / Esc / Tab キー処理
    window.addEventListener(
      'keydown',
      function (event) {
        const form = getForm();
        if (!form) {
          return;
        }

        if (event.key === 'F1') {
          event.preventDefault();
          event.stopPropagation();

          if (isHelpVisible()) {
            hideHelp();
            return;
          }

          const active = document.activeElement;
          if (active && typeof active.getAttribute === 'function') {
            const name = active.getAttribute('name');
            if (name) {
              const selector =
                '.help-indicator[data-parameter-name=\"' + name + '\"]';
              const icon = form.querySelector(selector);
              if (icon && typeof icon.getAttribute === 'function') {
                const help = icon.getAttribute('data-help') || '';
                showHelp(help);
                return;
              }
            }
          }

          return;
        }

        if (event.key === 'F10') {
          const button = document.getElementById('toggle-additional');
          if (button) {
            event.preventDefault();
            event.stopPropagation();
            setAdditionalVisible(!additionalShown);
          }
          return;
        }

        if (event.key === 'Escape') {
          if (isHelpVisible()) {
            event.preventDefault();
            event.stopPropagation();
            hideHelp();
            return;
          }
          vscode.postMessage({ type: 'cancel' });
          return;
        }

        if (event.key === 'Tab') {
          if (isHelpVisible()) {
            hideHelp();
          }
          const focusable = getFocusableElements(form);
          if (focusable.length === 0) {
            return;
          }

          const active = document.activeElement;
          let index = focusable.indexOf(active);

          if (event.shiftKey) {
            index = index <= 0 ? focusable.length - 1 : index - 1;
          } else {
            index = index === -1 || index === focusable.length - 1 ? 0 : index + 1;
          }

          const target = focusable[index];
          if (target && typeof target.focus === 'function') {
            event.preventDefault();
            target.focus();
          }
        }
      },
      true
    );

    // ヘルプアイコンのクリックでヘルプを表示
    const helpIcons = document.querySelectorAll('.help-indicator');
    for (const icon of helpIcons) {
      icon.addEventListener('click', function () {
        const help = this.getAttribute('data-help') || "";
        showHelp(help);
      });
    }

    // 値そのものがコマンドの欄で、さらにプロンプターを開く（F4 in F4）。
    // 開くのは拡張機能側。結果は setValue メッセージで返ってくる。
    function openCommandPrompter(name) {
      const input = document.querySelector('[name="' + name + '"]');
      vscode.postMessage({
        type: 'promptCommand',
        name: name,
        value: input ? input.value : ''
      });
    }

    const promptIcons = document.querySelectorAll('.prompt-indicator');
    for (const icon of promptIcons) {
      icon.addEventListener('click', function () {
        openCommandPrompter(this.getAttribute('data-parameter-name'));
      });
    }

    // コマンドの欄にフォーカスがある状態の F4 でも開く（SEU と同じ操作）。
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'F4') return;
      const active = document.activeElement;
      if (!active || !active.name) return;
      const indicator = document.querySelector(
        '.prompt-indicator[data-parameter-name="' + active.name + '"]'
      );
      if (indicator) {
        event.preventDefault();
        openCommandPrompter(active.name);
      }
    });

    // バックドロップのクリックでヘルプを閉じる
    const backdrop = document.querySelector('.help-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        hideHelp();
      });
    }

    // 入れ子のプロンプターで確定した値を欄に戻す。
    window.addEventListener('message', function (event) {
      const message = event.data;
      if (!message || message.type !== 'setValue') return;
      const input = document.querySelector('[name="' + message.name + '"]');
      if (input) {
        input.value = message.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // 起動確認用
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

/**
 * フィールド要素に、クライアント側での再評価に必要な属性を組み立てる。
 * dependsOn を持たない項目には何も付けない（常時表示・静的必須のまま）。
 */
function buildFieldRuleAttributes(field: SerializableField): string {
  const attributes = [
    ` data-field-name="${escapeHtml(field.name)}"`,
    ` data-static-required="${field.required ? "true" : "false"}"`
  ];

  // 追加パラメータ（実機の F10 側）は既定で畳む。
  if (field.additional) {
    attributes.push(' data-additional="true"');
  }

  if (field.dependsOn?.length) {
    attributes.push(
      ` data-depends-on="${escapeHtml(JSON.stringify(field.dependsOn))}"`
    );
  }

  if (!field.visible || field.additional) {
    attributes.push(' style="display:none"');
  }

  return attributes.join("");
}

function buildFieldControlHtml(field: SerializableField): string {
  const requiredAttr = field.required ? ' data-required="true"' : "";

  if (field.inputType === "dropdown" && field.options && field.options.length > 0) {
    const optionsHtml = field.options
      .map(option => {
        const selected = option.value === field.value ? " selected" : "";
        return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(
          option.label
        )}</option>`;
      })
      .join("\n");

    return `<select name="${escapeHtml(field.name)}"${requiredAttr}>
${optionsHtml}
</select>`;
  }

  const isRepeatable =
    typeof field.maxOccurrences === "number" && field.maxOccurrences > 1;

  if (isRepeatable) {
    const raw = field.value || "";
    const values = raw.length > 0 ? raw.split(/\r?\n/u) : [""];
    const itemsHtml = values
      .map((value, index) => {
        const removeButton =
          index === 0
            ? ""
            : `<button type="button" class="multi-remove" title="Remove">-</button>`;
        return `<div class="multi-item">
  <input type="text" class="multi-input" name="${escapeHtml(
    field.name
  )}" value="${escapeHtml(value)}"${requiredAttr} />
  ${removeButton}
</div>`;
      })
      .join("\n");

    return `<div class="multi-field" data-name="${escapeHtml(
      field.name
    )}" data-max="${field.maxOccurrences ?? ""}">
  <div class="multi-items">
${itemsHtml}
  </div>
  <button type="button" class="multi-add" data-name="${escapeHtml(
    field.name
  )}">追加</button>
</div>`;
  }

  // number / text / group は単一行テキスト入力として扱う。
  // 幅は最大長に合わせる（固定長を扱うため、桁数の目安として意味がある）。
  const size = field.maxLength && field.maxLength > 0 ? Math.min(field.maxLength, 40) : undefined;
  const sizeAttr = size ? ` size="${size}" maxlength="${field.maxLength}"` : "";
  return `<input type="text" name="${escapeHtml(field.name)}" value="${escapeHtml(
    field.value
  )}"${sizeAttr}${requiredAttr} />`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
