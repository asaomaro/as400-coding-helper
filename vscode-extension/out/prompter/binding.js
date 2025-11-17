"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSerializableState = toSerializableState;
exports.buildHtml = buildHtml;
function toSerializableState(definition, state, resolved) {
    const groupInfoByChildName = new Map();
    for (const parameter of definition.parameters) {
        if (parameter.inputType === "group" &&
            Array.isArray(parameter.children) &&
            parameter.children.length > 0) {
            const groupName = parameter.name;
            const groupLabel = parameter.description;
            for (const child of parameter.children) {
                groupInfoByChildName.set(child.name, { groupName, groupLabel });
            }
        }
    }
    return {
        keyword: definition.keyword,
        positionLine: resolved.line,
        positionColumn: resolved.column,
        fields: state.fields.map(field => ({
            name: field.parameter.name,
            label: field.parameter.description,
            value: field.value,
            required: field.parameter.required,
            inputType: field.parameter.inputType,
            options: field.parameter.options,
            error: field.error,
            hasHelp: Boolean(field.parameter.help && field.parameter.help.trim()),
            help: field.parameter.help,
            maxOccurrences: field.parameter.maxOccurrences,
            groupName: groupInfoByChildName.get(field.parameter.name)?.groupName,
            groupLabel: groupInfoByChildName.get(field.parameter.name)?.groupLabel
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
          <div class="field">
            <label>
              <span>${escapeHtml(child.label)}${child.required ? " *" : ""}${helpIcon}</span>
              ${controlHtml}
            </label>
            ${errorHtml}
          </div>`;
        })
            .join("\n");
        return `
      <fieldset class="field group-field">
        <legend>${escapeHtml(group.label)}</legend>
        ${childrenHtml}
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
        return `
      <div class="field">
        <label>
          <span>${escapeHtml(field.label)}${field.required ? " *" : ""}${helpIcon}</span>
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
    .field { margin-bottom: 8px; }
    .error { color: #be1100; font-size: 0.9em; }
    .buttons { margin-top: 12px; }
    .help-indicator { margin-left: 4px; color: #888; cursor: pointer; font-weight: bold; }
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
    }
    .has-error {
      border: 1px solid #be1100;
    }
    .multi-field { margin-top: 4px; }
    .multi-items { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
    .multi-item { display: flex; gap: 4px; }
  </style>
</head>
<body>
  <h2>${escapeHtml(state.keyword)} プロンプター</h2>
  <div id="help-overlay" class="help-overlay" aria-hidden="true">
    <div class="help-backdrop"></div>
    <div class="help-dialog">
      <div id="help-content"></div>
    </div>
  </div>
  <form id="prompter-form">
    ${fieldsHtml}
    <div class="buttons">
      <button type="submit">OK</button>
      <button type="button" id="cancel">Cancel</button>
    </div>
  </form>
  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();

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

    function validateForm(form) {
      let hasError = false;
      const inputs = form.querySelectorAll('input[name], select[name], textarea[name]');
      for (const input of inputs) {
        const required = input.getAttribute('data-required') === 'true';
        const value = String(input.value || '');
        clearFieldError(input);
        if (required && value.trim().length === 0) {
          hasError = true;
          setFieldError(input, 'A value is required.');
        }
      }
      return !hasError;
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

    // 初期フォーカスと複数項目ボタンのセットアップ
    focusFirstField();
    setupMultiFieldButtons();

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

    // バックドロップのクリックでヘルプを閉じる
    const backdrop = document.querySelector('.help-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        hideHelp();
      });
    }

    // 起動確認用
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
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
    // number / text / group は単一行テキスト入力として扱う
    return `<input type="text" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value)}"${requiredAttr} />`;
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