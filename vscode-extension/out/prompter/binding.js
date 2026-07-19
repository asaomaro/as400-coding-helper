"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSerializableState = toSerializableState;
exports.buildHtml = buildHtml;
const commandHelp_1 = require("./commandHelp");
const occurrences_1 = require("./occurrences");
/**
 * 繰り返し group の「最後の一組」を求める。ここにだけ追加ボタンを出す。
 * 途中の組に出すと、どこに追加されるのか分からなくなるため。
 */
function buildRepeatableGroups(definition, state) {
    const result = {};
    for (const parameter of definition.parameters) {
        if (!(0, occurrences_1.isRepeatableGroup)(parameter))
            continue;
        const last = state.fields
            .filter(field => leafNamesOf(parameter).has(field.parameter.name))
            .reduce((max, field) => Math.max(max, field.occurrence), 0);
        result[(0, occurrences_1.occurrenceName)(parameter.name, last)] = {
            base: parameter.name,
            max: parameter.maxOccurrences ?? 1
        };
    }
    return result;
}
function leafNamesOf(parameter) {
    return new Set(flattenForConstraints([parameter]).map(leaf => leaf.name));
}
/** 相関制約の判定に使う末端パラメータを集める（group は入れ子になりうる）。 */
function flattenForConstraints(parameters) {
    return parameters.flatMap(parameter => parameter.inputType === "group" && parameter.children?.length
        ? flattenForConstraints(parameter.children)
        : [parameter]);
}
function toSerializableState(definition, state, resolved) {
    const groupInfoByChildName = new Map();
    // group は入れ子になりうる（例: ALCOBJ.OBJ の要素1が修飾名）。
    // 末端の入力欄はすべて最上位 group に束ね、階層は見出しに連ねて示す。
    const registerGroup = (parameters, rootName, labelPath = []) => {
        for (const parameter of parameters) {
            const isGroup = parameter.inputType === "group" &&
                Array.isArray(parameter.children) &&
                parameter.children.length > 0;
            if (isGroup) {
                registerGroup(parameter.children ?? [], rootName ?? parameter.name, [
                    ...labelPath,
                    parameter.description
                ]);
            }
            else if (rootName) {
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
    const additionalNames = new Set();
    if (hasBasicInfo) {
        for (const parameter of definition.parameters) {
            if (parameter.basic)
                continue;
            for (const leaf of flattenForConstraints([parameter]))
                additionalNames.add(leaf.name);
        }
    }
    return {
        keyword: definition.keyword,
        positionLine: resolved.line,
        positionColumn: resolved.column,
        commandHelp: (0, commandHelp_1.buildCommandHelpText)(definition),
        constraints: definition.constraints,
        repeatableGroups: buildRepeatableGroups(definition, state),
        // 相関制約の「指定した」判定に既定値が要るため、対象パラメータの末端を渡す。
        constraintFields: definition.constraints?.length
            ? Object.fromEntries([...new Set(definition.constraints.flatMap(c => c.parameters))].map(name => {
                const parameter = definition.parameters.find(p => p.name === name);
                const leaves = parameter ? flattenForConstraints([parameter]) : [];
                return [
                    name,
                    leaves.map(leaf => ({ name: leaf.name, defaultValue: leaf.defaultValue ?? "" }))
                ];
            }))
            : undefined,
        // 非表示項目もマークアップ上は出力し、クライアント側で入力値に追従して
        // 表示/必須を切り替える（除外してしまうと条件成立時に入力できなくなる）。
        fields: state.fields.map(field => ({
            name: field.fieldName,
            // 繰り返しの2件目以降は見出しに件数を添えて区別できるようにする。
            label: field.occurrence > 0
                ? `${field.parameter.description} (${field.occurrence + 1})`
                : field.parameter.description,
            value: field.value,
            // 静的な定義値ではなく dependsOn 評価後の実効必須を UI に渡す。
            required: field.required,
            inputType: field.parameter.inputType,
            options: field.parameter.options,
            error: field.error,
            hasHelp: Boolean((0, commandHelp_1.buildParameterHelpText)(field.parameter)),
            commandValued: field.parameter.valueKind === "command",
            help: (0, commandHelp_1.buildParameterHelpText)(field.parameter),
            maxOccurrences: field.parameter.maxOccurrences,
            maxLength: field.parameter.attributes?.maxLength,
            groupName: (() => {
                const info = groupInfoByChildName.get(field.parameter.name);
                return info ? (0, occurrences_1.occurrenceName)(info.groupName, field.occurrence) : undefined;
            })(),
            groupLabel: (() => {
                const info = groupInfoByChildName.get(field.parameter.name);
                if (!info)
                    return undefined;
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
function buildHtml(state, options) {
    const standaloneFields = [];
    const groups = new Map();
    const groupOrder = [];
    for (const field of state.fields) {
        if (field.groupName) {
            let group = groups.get(field.groupName);
            if (!group) {
                group = {
                    label: field.groupLabel ?? field.groupName,
                    fields: []
                };
                groups.set(field.groupName, group);
                groupOrder.push(field.groupName);
            }
            group.fields.push(field);
        }
        else {
            standaloneFields.push(field);
        }
    }
    const groupHtml = groupOrder
        .map(groupName => {
        const group = groups.get(groupName);
        if (!group) {
            return "";
        }
        const childrenHtml = group.fields
            .map(child => {
            const controlHtml = buildFieldControlHtml(child);
            const errorHtml = child.error
                ? `<div class="error">${escapeHtml(child.error)}</div>`
                : "";
            const helpIcon = child.hasHelp
                ? `<span class="help-indicator" data-parameter-name="${escapeHtml(child.name)}" data-help="${escapeHtml(child.help ?? "")}" title="F1 でヘルプを表示">?</span>`
                : "";
            return `
          <div class="field"${buildFieldRuleAttributes(child)}>
            <label>
              <span>${escapeHtml(child.label)}<span class="required-mark">${child.required ? " *" : ""}</span>${helpIcon}</span>
              ${controlHtml}
            </label>
            ${errorHtml}
          </div>`;
        })
            .join("\n");
        // 繰り返し指定の group は、最後の一組にだけ「追加」ボタンを出す。
        const repeat = state.repeatableGroups?.[groupName];
        const addButton = repeat
            ? `<button type="button" class="group-add" data-group="${escapeHtml(repeat.base)}" data-max="${repeat.max}">追加</button>`
            : "";
        const groupAdditional = group.fields.every(f => f.additional);
        return `
      <fieldset class="field group-field" data-group-name="${escapeHtml(groupName)}"${groupAdditional ? ' data-additional="true" style="display:none"' : ""}>
        <legend>${escapeHtml(group.label)}</legend>
        ${childrenHtml}
        ${addButton}
      </fieldset>`;
    })
        .join("\n");
    const standaloneHtml = standaloneFields
        .map(field => {
        const controlHtml = buildFieldControlHtml(field);
        const errorHtml = field.error
            ? `<div class="error">${escapeHtml(field.error)}</div>`
            : "";
        const helpIcon = field.hasHelp
            ? `<span class="help-indicator" data-parameter-name="${escapeHtml(field.name)}" data-help="${escapeHtml(field.help ?? "")}" title="F1 でヘルプを表示">?</span>`
            : "";
        // 値そのものがコマンドの欄（SBMJOB の CMD など）は、そこでさらに
        // プロンプターを開ける。SEU の F4 in F4 に相当する。
        const promptButton = field.commandValued
            ? `<span class="prompt-indicator" data-parameter-name="${escapeHtml(field.name)}" title="F4 でコマンドのプロンプターを開く">F4</span>`
            : "";
        return `
      <div class="field"${buildFieldRuleAttributes(field)}>
        <label>
          <span>${escapeHtml(field.label)}<span class="required-mark">${field.required ? " *" : ""}</span>${helpIcon}${promptButton}</span>
          ${controlHtml}
        </label>
        ${errorHtml}
      </div>`;
    })
        .join("\n");
    const fieldsHtml = [groupHtml, standaloneHtml].filter(Boolean).join("\n");
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
    .multi-field { margin-top: 4px; }
    .multi-items { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
    .multi-item { display: flex; gap: 4px; }
  </style>
</head>
<body>
  <h2>${escapeHtml(state.keyword)} プロンプター${state.commandHelp
        ? `<span class="help-indicator" id="command-help" data-help="${escapeHtml(state.commandHelp)}" title="コマンドのヘルプを表示">?</span>`
        : ""}</h2>
  <div id="help-overlay" class="help-overlay" aria-hidden="true">
    <div class="help-backdrop"></div>
    <div class="help-dialog">
      <div id="help-content"></div>
    </div>
  </div>
  <form id="prompter-form">
    <div id="constraint-errors" class="error constraint-errors" style="display:none"></div>
    ${fieldsHtml}
    ${state.fields.some(f => f.additional)
        ? `<button type="button" id="toggle-additional" class="toggle-additional">追加パラメーターを表示 (F10)</button>`
        : ""}
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

        fieldset.parentNode.insertBefore(clone, fieldset.nextSibling);
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
function buildFieldRuleAttributes(field) {
    const attributes = [
        ` data-field-name="${escapeHtml(field.name)}"`,
        ` data-static-required="${field.required ? "true" : "false"}"`
    ];
    // 追加パラメータ（実機の F10 側）は既定で畳む。
    if (field.additional) {
        attributes.push(' data-additional="true"');
    }
    if (field.dependsOn?.length) {
        attributes.push(` data-depends-on="${escapeHtml(JSON.stringify(field.dependsOn))}"`);
    }
    if (!field.visible || field.additional) {
        attributes.push(' style="display:none"');
    }
    return attributes.join("");
}
function buildFieldControlHtml(field) {
    const requiredAttr = field.required ? ' data-required="true"' : "";
    if (field.inputType === "dropdown" && field.options && field.options.length > 0) {
        const optionsHtml = field.options
            .map(option => {
            const selected = option.value === field.value ? " selected" : "";
            return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
        })
            .join("\n");
        return `<select name="${escapeHtml(field.name)}"${requiredAttr}>
${optionsHtml}
</select>`;
    }
    const isRepeatable = typeof field.maxOccurrences === "number" && field.maxOccurrences > 1;
    if (isRepeatable) {
        const raw = field.value || "";
        const values = raw.length > 0 ? raw.split(/\r?\n/u) : [""];
        const itemsHtml = values
            .map((value, index) => {
            const removeButton = index === 0
                ? ""
                : `<button type="button" class="multi-remove" title="Remove">-</button>`;
            return `<div class="multi-item">
  <input type="text" class="multi-input" name="${escapeHtml(field.name)}" value="${escapeHtml(value)}"${requiredAttr} />
  ${removeButton}
</div>`;
        })
            .join("\n");
        return `<div class="multi-field" data-name="${escapeHtml(field.name)}" data-max="${field.maxOccurrences ?? ""}">
  <div class="multi-items">
${itemsHtml}
  </div>
  <button type="button" class="multi-add" data-name="${escapeHtml(field.name)}">追加</button>
</div>`;
    }
    // number / text / group は単一行テキスト入力として扱う。
    // 幅は最大長に合わせる（固定長を扱うため、桁数の目安として意味がある）。
    const size = field.maxLength && field.maxLength > 0 ? Math.min(field.maxLength, 40) : undefined;
    const sizeAttr = size ? ` size="${size}" maxlength="${field.maxLength}"` : "";
    return `<input type="text" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value)}"${sizeAttr}${requiredAttr} />`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
//# sourceMappingURL=binding.js.map