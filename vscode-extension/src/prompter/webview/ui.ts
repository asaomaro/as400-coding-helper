import "./ui.css";
import { buildInitialState } from "../model";
import {
  buildBlocks,
  toSerializableState,
  type GroupBlock,
  type SerializableField,
  type SerializablePrompterState
} from "../formModel";
import { collectLeaves, occurrenceName } from "../occurrences";
import type { ObjectCandidates, ParameterDefinition, PrompterDefinition } from "../types";
import type { Bridge } from "./bridge";
import type { HostMessage, PrompterHost } from "./protocol";

/**
 * F4 プロンプターの画面。**素の web として書く（`vscode` を知らない）。**
 *
 * ## 判断を持たない
 *
 * 表示 / 必須 / 入力可否 / 許可値 / 検証 / 相関制約は**すべてコアが決める**
 * （`model.ts` の `buildInitialState`、`formModel.ts` の `toSerializableState`）。
 * ここがするのは「描く」と「押されたことを伝える」だけ。
 *
 * 以前は同じ判定が `binding.ts` のインライン JS に手書きで写されており、
 * 「片方だけ直すと食い違う」と注意書きで守っていた。実際に食い違ってもいた
 * （`visibleByDefault` を見ていなかった）。**写しを持たないのがこの作りの要点。**
 *
 * ## 描き直しは 2 段
 *
 * - `rebuild()` … 欄の**構成**が変わったとき（読み込み・組の増減・F10）。DOM を作り直す。
 * - `refresh()` … 入力のたび。**構成は変えず**、表示 / 必須 / エラー / 選択肢だけ更新する。
 *
 * 分けているのは、1 文字打つたびに DOM を作り直すとフォーカスとカーソル位置が飛ぶため。
 */

/** 画面が保持する状態。**値と、いくつ見せているか、だけ。** */
interface Session {
  readonly definition: PrompterDefinition;
  readonly host: PrompterHost;
  readonly objectCandidates: ObjectCandidates;
  /** 入力欄名 → 値。複数値の欄は改行区切りで持つ（`formModel` が同じ約束で読む）。 */
  values: Record<string, string>;
  /** 繰り返し group ごとの表示している組数。値からは復元しきれないので持つ。 */
  occurrences: Record<string, number>;
  additionalShown: boolean;
  /**
   * 一度でも確定を押したか。
   * **押すまでは「必須なのに空」を咎めない**（開いた瞬間に赤字が並ぶと警告にならない）。
   */
  submitAttempted: boolean;
}

/**
 * プロンプターを `root` に組み立て、`bridge` でホストと会話し始める。
 *
 * 戻り値は無い。**画面の中を外から覗く口を作らない**——確かめたいのは
 * 「押したらどうなるか」なので、e2e は実際の DOM を見る（`dev/prompter-e2e.mjs`）。
 */
export function startPrompter(bridge: Bridge, root: HTMLElement): void {
  let session: Session | undefined;
  let model: SerializablePrompterState | undefined;

  // --- 部品 ---------------------------------------------------------------

  const overlay = el("div", { className: "help-overlay" });
  const helpContent = el("div", { className: "help-content" });
  overlay.appendChild(el("div", { className: "help-backdrop" }));
  const dialog = el("div", { className: "help-dialog" });
  dialog.appendChild(helpContent);
  overlay.appendChild(dialog);

  const heading = el("h2", { className: "prompter-title" });
  const constraintBanner = el("div", { className: "error constraint-errors hidden" });
  const form = el("form", { className: "prompter-form" }) as HTMLFormElement;
  const fieldsRoot = el("div", { className: "fields" });
  const datalists = el("div", { className: "datalists" });
  const toggleAdditional = el("button", {
    className: "toggle-additional hidden",
    type: "button"
  }) as HTMLButtonElement;
  const buttons = el("div", { className: "buttons" });
  const okButton = el("button", { type: "submit", textContent: "OK" }) as HTMLButtonElement;
  const cancelButton = el("button", {
    type: "button",
    className: "cancel",
    textContent: "Cancel"
  }) as HTMLButtonElement;
  buttons.appendChild(okButton);
  buttons.appendChild(cancelButton);

  form.appendChild(constraintBanner);
  form.appendChild(datalists);
  form.appendChild(fieldsRoot);
  form.appendChild(toggleAdditional);
  form.appendChild(buttons);

  root.appendChild(heading);
  root.appendChild(overlay);
  root.appendChild(form);

  // --- ヘルプ -------------------------------------------------------------

  const helpVisible = (): boolean => overlay.classList.contains("visible");
  /** ヘルプを開く前にフォーカスがあった欄。閉じたらここへ戻す。 */
  let helpOpener: HTMLElement | undefined;

  function showHelp(text: string): void {
    helpOpener = (document.activeElement as HTMLElement | null) ?? undefined;
    helpContent.textContent = text;
    overlay.classList.add("visible");
  }

  function hideHelp(): void {
    if (!helpVisible()) return;
    overlay.classList.remove("visible");
    // 開く前の欄へ戻す。戻さないとキーボードだけの操作がここで途切れる。
    if (helpOpener && document.contains(helpOpener)) helpOpener.focus();
    helpOpener = undefined;
  }

  overlay.querySelector(".help-backdrop")?.addEventListener("click", () => hideHelp());

  // --- 値の出し入れ -------------------------------------------------------

  /** DOM の入力欄から値を集め直す。複数値の欄は改行でつなぐ。 */
  function collectValues(): Record<string, string> {
    const values: Record<string, string> = { ...(session?.values ?? {}) };
    const multi = new Set<string>();

    for (const node of form.querySelectorAll<HTMLElement>(".multi-field[data-name]")) {
      const name = node.dataset.name;
      if (!name) continue;
      multi.add(name);
      values[name] = [...node.querySelectorAll<HTMLInputElement>("input[name]")]
        .map(input => input.value)
        .join("\n");
    }

    for (const control of controlsIn(form)) {
      const name = control.getAttribute("name");
      if (!name || multi.has(name)) continue;
      values[name] = control.value;
    }
    return values;
  }

  // --- 描画 ---------------------------------------------------------------

  /** 欄の構成ごと作り直す。読み込み・組の増減・F10 の切り替えで呼ぶ。 */
  function rebuild(): void {
    if (!session) return;
    const focused = focusMemo();

    model = deriveModel(session);
    heading.textContent = "";
    heading.appendChild(document.createTextNode(`${model.keyword} プロンプター`));
    if (model.commandHelp) {
      const icon = el("span", {
        className: "help-indicator",
        id: "command-help",
        textContent: "?",
        title: "コマンドのヘルプを表示"
      });
      icon.addEventListener("click", () => showHelp(model?.commandHelp ?? ""));
      heading.appendChild(icon);
    }

    datalists.textContent = "";
    if (session.host.providesObjectCandidates) {
      for (const [kind, names] of Object.entries(session.objectCandidates)) {
        const list = el("datalist", { id: `objects-${kind}` });
        for (const name of names ?? []) {
          list.appendChild(el("option", { value: name }));
        }
        datalists.appendChild(list);
      }
    }

    fieldsRoot.textContent = "";
    for (const block of buildBlocks(model)) {
      fieldsRoot.appendChild(
        block.kind === "field" ? renderField(block.field) : renderGroup(block)
      );
    }

    const hasAdditional = model.fields.some(field => field.additional);
    toggleAdditional.classList.toggle("hidden", !hasAdditional);
    toggleAdditional.textContent = session.additionalShown
      ? "追加パラメーターを隠す (F10)"
      : "追加パラメーターを表示 (F10)";

    refresh();
    focused.restore();
  }

  /**
   * 構成は変えずに、表示 / 必須 / エラー / 選択肢だけ更新する。
   * 入力のたびに呼ぶので、**DOM を作り直さない**（フォーカスが飛ぶため）。
   */
  function refresh(): void {
    if (!session) return;
    session.values = collectValues();

    // 入力不可になった欄は値を捨てる。残すと、見えない値が確定時に混ざる。
    // 1 度だけ作り直して見る（現行の `applyDependencyRules` も入力 1 回につき 1 度）。
    let derived = deriveModel(session);
    let cleared = false;
    for (const field of derived.fields) {
      if (field.disabled && session.values[field.name]) {
        session.values[field.name] = "";
        cleared = true;
      }
    }
    if (cleared) derived = deriveModel(session);
    model = derived;

    for (const field of derived.fields) {
      const node = form.querySelector<HTMLElement>(
        `.field[data-field-name="${cssEscape(field.name)}"]`
      );
      if (!node) continue;

      const visible = shown(field, session.additionalShown);
      node.classList.toggle("hidden", !visible);

      const mark = node.querySelector(".required-mark");
      if (mark) mark.textContent = field.required ? " *" : "";

      // **見えない欄には赤字を出さない。** 出すと、確定できたのに F10 を開いた
      // 途端に赤が並ぶ（確定を止めた覚えの無いエラーが見える）。
      // 咎めないと決めた欄は、表示の上でも咎めない。
      const error = visible ? field.error : undefined;

      const errorNode = node.querySelector<HTMLElement>(".error");
      if (errorNode) errorNode.textContent = error ?? "";

      for (const control of controlsIn(node)) {
        control.disabled = field.disabled;
        if (field.disabled) control.value = "";
        control.classList.toggle("has-error", Boolean(error));
        if (error) control.title = error;
        else control.removeAttribute("title");
        applyAllowedValues(control, field.allowedValues);
      }
    }

    // 囲みごと隠れる場合（中身が全部追加パラメーター）。
    for (const box of form.querySelectorAll<HTMLElement>(".group-field[data-group-name]")) {
      const inner = [...box.querySelectorAll<HTMLElement>(".field[data-field-name]")];
      box.classList.toggle(
        "hidden",
        inner.length > 0 && inner.every(node => node.classList.contains("hidden"))
      );
    }

    const messages = derived.constraintErrors;
    constraintBanner.textContent = messages.join("\n");
    constraintBanner.classList.toggle("hidden", messages.length === 0);
  }

  function renderField(field: SerializableField): HTMLElement {
    const node = el("div", { className: "field" });
    node.dataset.fieldName = field.name;
    if (field.additional) node.dataset.additional = "true";

    const label = el("label");
    const caption = el("span", { className: "field-label" });
    caption.appendChild(document.createTextNode(field.label));
    caption.appendChild(el("span", { className: "required-mark" }));

    if (field.hasHelp) {
      const icon = el("span", {
        className: "help-indicator",
        textContent: "?",
        title: "F1 でヘルプを表示"
      });
      icon.dataset.parameterName = field.name;
      icon.addEventListener("click", () => showHelp(field.help ?? ""));
      caption.appendChild(icon);
    }

    // 値そのものがコマンドの欄（SBMJOB の CMD など）は、そこでさらにプロンプターを開ける。
    // **開けるホストのときだけ印を出す**——押しても何も起きない印は出さない。
    if (field.commandValued && session?.host.opensNestedPrompter) {
      const icon = el("span", {
        className: "prompt-indicator",
        textContent: "F4",
        title: "F4 でコマンドのプロンプターを開く"
      });
      icon.dataset.parameterName = field.name;
      icon.addEventListener("click", () => promptCommand(field.name));
      caption.appendChild(icon);
    }

    label.appendChild(caption);
    label.appendChild(buildControl(field));
    node.appendChild(label);
    node.appendChild(el("div", { className: "error" }));
    return node;
  }

  function renderGroup(block: GroupBlock): HTMLElement {
    const box = el("fieldset", { className: "field group-field" });
    box.dataset.groupName = block.name;
    box.appendChild(el("legend", { textContent: block.label }));
    for (const field of block.fields) box.appendChild(renderField(field));

    // 繰り返し指定の group は、最後の一組にだけ「追加」を出す。
    // 途中の組に出すと、どこに追加されるのか分からない。
    const repeat = model?.repeatableGroups?.[block.name];
    if (repeat) {
      const add = el("button", {
        type: "button",
        className: "group-add",
        textContent: "追加"
      }) as HTMLButtonElement;
      add.dataset.group = repeat.base;
      add.addEventListener("click", event => {
        event.preventDefault();
        addOccurrence(repeat.base, repeat.max);
      });
      box.appendChild(add);
    }

    // 削除は 2 組目以降だけ。1 組目を消すとパラメータ自体が無くなる。
    const index = occurrenceIndexOf(block.name);
    if (index > 0) {
      const remove = el("button", {
        type: "button",
        className: "group-remove",
        textContent: "削除"
      }) as HTMLButtonElement;
      remove.dataset.group = block.name;
      remove.addEventListener("click", event => {
        event.preventDefault();
        removeOccurrence(baseNameOf(block.name), index);
      });
      box.appendChild(remove);
    }
    return box;
  }

  function buildControl(field: SerializableField): HTMLElement {
    if (field.inputType === "dropdown" && field.options && field.options.length > 0) {
      const select = el("select", { name: field.name }) as HTMLSelectElement;
      for (const option of field.options) {
        select.appendChild(el("option", { value: option.value, textContent: option.label }));
      }
      select.value = field.value;
      return select;
    }

    if (typeof field.maxOccurrences === "number" && field.maxOccurrences > 1) {
      return buildMultiField(field);
    }

    return buildTextInput(field, field.value);
  }

  /** 複数値の欄（`+` / `-` で増減する）。値は改行区切りで持つ。 */
  function buildMultiField(field: SerializableField): HTMLElement {
    const max = field.maxOccurrences ?? 1;
    const wrapper = el("div", { className: "multi-field" });
    wrapper.dataset.name = field.name;
    wrapper.dataset.max = String(max);
    const items = el("div", { className: "multi-items" });

    const values = field.value.length > 0 ? field.value.split(/\r?\n/u) : [""];
    values.forEach((value, index) => {
      items.appendChild(multiItem(field, value, index > 0));
    });
    wrapper.appendChild(items);

    const add = el("button", {
      type: "button",
      className: "multi-add",
      textContent: "追加"
    }) as HTMLButtonElement;
    add.dataset.name = field.name;
    add.addEventListener("click", event => {
      event.preventDefault();
      if (items.querySelectorAll(".multi-item").length >= max) return;
      const item = multiItem(field, "", true);
      items.appendChild(item);
      item.querySelector("input")?.focus();
      refresh();
    });
    wrapper.appendChild(add);
    return wrapper;
  }

  function multiItem(
    field: SerializableField,
    value: string,
    removable: boolean
  ): HTMLElement {
    const item = el("div", { className: "multi-item" });
    const input = buildTextInput(field, value);
    input.classList.add("multi-input");
    item.appendChild(input);

    if (removable) {
      const remove = el("button", {
        type: "button",
        className: "multi-remove",
        textContent: "-",
        title: "Remove"
      }) as HTMLButtonElement;
      remove.addEventListener("click", event => {
        event.preventDefault();
        const items = item.parentElement;
        if (!items || items.querySelectorAll(".multi-item").length <= 1) return;
        item.remove();
        refresh();
      });
      item.appendChild(remove);
    }
    return item;
  }

  function buildTextInput(field: SerializableField, value: string): HTMLInputElement {
    const input = el("input", { type: "text", name: field.name }) as HTMLInputElement;
    input.value = value;

    // 幅は最大長に合わせる（固定長を扱うので桁数の目安として意味がある）。
    if (field.maxLength && field.maxLength > 0) {
      input.size = Math.min(field.maxLength, 40);
      // **CL 変数(&NAME)は欄の長さより長くなりうる。** maxlength をそのまま出すと
      // ブラウザが入力を打ち切り、MSGID(7 文字)の欄に &MSGIDVAR と書けなくなる。
      // 変数を書ける欄では 11 文字(& + 名前 10)まで許す。
      const variableRoom = field.allowsVariable === false ? 0 : VARIABLE_ROOM;
      input.maxLength = Math.max(field.maxLength, variableRoom);
    }
    if (field.objectKind && session?.host.providesObjectCandidates) {
      input.setAttribute("list", `objects-${field.objectKind}`);
    }
    return input;
  }

  // --- 繰り返しの増減 -----------------------------------------------------

  function addOccurrence(base: string, max: number): void {
    if (!session) return;
    const current = session.occurrences[base] ?? 1;
    if (current >= max) return;
    session.occurrences[base] = current + 1;
    rebuild();
  }

  /**
   * 組を 1 つ消す。**後ろの組を繰り上げる**（連番が飛ぶと値と入力欄名の対応が崩れる）。
   * 以前は DOM を複製して番号を振り直していたが、値を動かせば済む。
   */
  function removeOccurrence(base: string, index: number): void {
    if (!session) return;
    const parameter = findParameter(session.definition.parameters, base);
    if (!parameter) return;
    const count = session.occurrences[base] ?? 1;
    if (count <= 1) return;

    const leaves = collectLeaves(parameter.children ?? []);
    for (let slot = index; slot < count - 1; slot += 1) {
      for (const leaf of leaves) {
        session.values[occurrenceName(leaf.name, slot)] =
          session.values[occurrenceName(leaf.name, slot + 1)] ?? "";
      }
    }
    for (const leaf of leaves) {
      delete session.values[occurrenceName(leaf.name, count - 1)];
    }
    session.occurrences[base] = count - 1;
    rebuild();
  }

  // --- 確定・取消 ---------------------------------------------------------

  function submit(): void {
    if (!session) return;
    session.submitAttempted = true;
    refresh();
    if (!model) return;

    // **見えない欄は咎めない。** 隠れている欄でエラーを出すと原因が分からない。
    const blocking = model.fields.filter(
      field => shown(field, session!.additionalShown) && field.error
    );
    if (blocking.length > 0 || model.constraintErrors.length > 0) {
      const first = blocking[0];
      if (first) {
        form
          .querySelector<HTMLElement>(
            `.field[data-field-name="${cssEscape(first.name)}"] input, ` +
              `.field[data-field-name="${cssEscape(first.name)}"] select`
          )
          ?.focus();
      }
      return;
    }

    bridge.post({ type: "submit", values: submittedValues() });
  }

  /** 確定して送る値。複数値の欄だけが配列になり、空は落とす。 */
  function submittedValues(): Record<string, string | string[]> {
    const values: Record<string, string | string[]> = {};
    const multi = new Set(
      [...form.querySelectorAll<HTMLElement>(".multi-field[data-name]")].map(
        node => node.dataset.name ?? ""
      )
    );

    for (const [name, value] of Object.entries(session?.values ?? {})) {
      if (multi.has(name)) {
        const items = value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean);
        if (items.length > 0) values[name] = items;
        continue;
      }
      values[name] = value;
    }
    return values;
  }

  function promptCommand(name: string): void {
    bridge.post({ type: "promptCommand", name, value: session?.values[name] ?? "" });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    submit();
  });
  cancelButton.addEventListener("click", () => bridge.post({ type: "cancel" }));
  form.addEventListener("input", () => refresh());
  form.addEventListener("change", () => refresh());
  toggleAdditional.addEventListener("click", event => {
    event.preventDefault();
    if (!session) return;
    session.additionalShown = !session.additionalShown;
    rebuild();
  });

  // --- キー操作 -----------------------------------------------------------

  window.addEventListener(
    "keydown",
    event => {
      if (!session) return;

      if (event.key === "F1") {
        event.preventDefault();
        event.stopPropagation();
        if (helpVisible()) {
          hideHelp();
          return;
        }
        const name = (document.activeElement as HTMLElement | null)?.getAttribute("name");
        const field = name
          ? model?.fields.find(candidate => candidate.name === name)
          : undefined;
        if (field?.hasHelp) showHelp(field.help ?? "");
        return;
      }

      if (event.key === "F4") {
        const name = (document.activeElement as HTMLElement | null)?.getAttribute("name");
        const field = name
          ? model?.fields.find(candidate => candidate.name === name)
          : undefined;
        if (field?.commandValued && session.host.opensNestedPrompter) {
          event.preventDefault();
          promptCommand(field.name);
        }
        return;
      }

      if (event.key === "F10") {
        if (toggleAdditional.classList.contains("hidden")) return;
        event.preventDefault();
        event.stopPropagation();
        session.additionalShown = !session.additionalShown;
        rebuild();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (helpVisible()) {
          hideHelp();
          return;
        }
        bridge.post({ type: "cancel" });
        return;
      }

      // **巡回は自前で持つ。** WebView の既定の Tab は最後の欄からフォームの外へ抜け、
      // 戻ってこられなくなる。
      if (event.key === "Tab") {
        if (helpVisible()) hideHelp();
        const focusable = focusableElements();
        if (focusable.length === 0) return;

        const active = document.activeElement as HTMLElement | null;
        let index = active ? focusable.indexOf(active) : -1;
        if (event.shiftKey) {
          index = index <= 0 ? focusable.length - 1 : index - 1;
        } else {
          index = index === -1 || index === focusable.length - 1 ? 0 : index + 1;
        }
        event.preventDefault();
        focusable[index]?.focus();
      }
    },
    true
  );

  function focusableElements(): HTMLElement[] {
    return [
      ...form.querySelectorAll<HTMLElement>(
        "button, input[name], select[name], textarea[name]"
      )
    ].filter(node => {
      const control = node as HTMLElement & { disabled?: boolean };
      if (control.disabled) return false;
      // 隠れている欄は巡回に入れない（見えないところへフォーカスが飛ぶ）。
      return node.closest(".hidden") === null;
    });
  }

  /** 描き直しの前後でフォーカスとカーソル位置を保つ。 */
  function focusMemo(): { restore: () => void } {
    const active = document.activeElement as HTMLInputElement | null;
    const name = active?.getAttribute("name") ?? undefined;
    const start = active?.selectionStart ?? null;
    return {
      restore() {
        if (!name) return;
        const next = form.querySelector<HTMLInputElement>(
          `[name="${cssEscape(name)}"]`
        );
        if (!next) return;
        next.focus();
        if (start !== null && typeof next.setSelectionRange === "function") {
          try {
            next.setSelectionRange(start, start);
          } catch {
            // type によっては選択位置を持たない。位置が戻らないだけなので無視する。
          }
        }
      }
    };
  }

  // --- ホストからの受信 ---------------------------------------------------

  bridge.onMessage((message: HostMessage) => {
    if (message.type === "load") {
      session = {
        definition: message.definition,
        host: message.host,
        objectCandidates: message.objectCandidates,
        values: { ...message.values },
        occurrences: {},
        additionalShown: false,
        submitAttempted: false
      };
      // 値から数えた組数を出発点にする（既にソースに複数組書かれている場合）。
      const initial = deriveModel(session);
      for (const [groupName, repeat] of Object.entries(initial.repeatableGroups ?? {})) {
        session.occurrences[repeat.base] = occurrenceIndexOf(groupName) + 1;
      }
      rebuild();
      // 開いたら最初の欄へ。キーボードだけで始められるようにする。
      focusableElements()[0]?.focus();
      return;
    }

    if (message.type === "setValue") {
      if (!session) return;
      // **値の持ち主は `session.values` の側**。ここで入力欄へ直接書くと、
      // 次の `refresh()` が DOM から集め直したときに元の値へ戻ってしまう
      // （入れ子で確定した値が静かに消える）。値を入れて描き直す。
      session.values[message.name] = message.value;
      rebuild();
      form.querySelector<HTMLInputElement>(`[name="${cssEscape(message.name)}"]`)?.focus();
    }
  });

  bridge.post({ type: "ready" });
}

// --- ここから下は描画に依存しない小物 ---------------------------------------

/** CL 変数（`&` + 名前 10 文字）の分だけ入力欄に余地を残す。 */
const VARIABLE_ROOM = 11;

/** 描画モデルは**毎回コアから作り直す**。ここに判断は無い。 */
function deriveModel(session: Session): SerializablePrompterState {
  return toSerializableState(
    session.definition,
    buildInitialState(session.definition, session.values, {
      occurrences: session.occurrences,
      reportEmptyRequired: session.submitAttempted
    }),
    session.objectCandidates
  );
}

/** 画面に出ている欄か。隠れている欄は検証もしないし、巡回にも入れない。 */
function shown(field: SerializableField, additionalShown: boolean): boolean {
  if (!field.visible) return false;
  return !field.additional || additionalShown;
}

function occurrenceIndexOf(fieldName: string): number {
  const at = fieldName.lastIndexOf("#");
  if (at < 0) return 0;
  const parsed = Number(fieldName.slice(at + 1));
  return Number.isFinite(parsed) && parsed > 1 ? parsed - 1 : 0;
}

function baseNameOf(fieldName: string): string {
  const at = fieldName.lastIndexOf("#");
  return at < 0 ? fieldName : fieldName.slice(0, at);
}

function findParameter(
  parameters: readonly ParameterDefinition[],
  name: string
): ParameterDefinition | undefined {
  for (const parameter of parameters) {
    if (parameter.name === name) return parameter;
    const child = findParameter(parameter.children ?? [], name);
    if (child) return child;
  }
  return undefined;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controlsIn(root: ParentNode): Control[] {
  return [...root.querySelectorAll<Control>("input[name], select[name], textarea[name]")];
}

/**
 * 相関で絞られた選択肢を欄に反映する。
 * `select` は選べなくし、テキスト欄は検証がコア側で効くので何もしない。
 */
function applyAllowedValues(control: Control, allowed: readonly string[] | undefined): void {
  if (!(control instanceof HTMLSelectElement)) return;
  const permitted =
    allowed === undefined
      ? undefined
      : new Set(allowed.map(value => value.trim().toUpperCase()));

  for (const option of [...control.options]) {
    const ok = permitted === undefined || permitted.has(option.value.trim().toUpperCase());
    option.disabled = !ok;
    option.hidden = !ok;
  }
}

/**
 * 属性セレクタに入れる文字を逃がす。
 * 入力欄名には `#`（繰り返しの連番）が入るので、素で書くと ID 扱いになる。
 */
function cssEscape(value: string): string {
  return value.replace(/["\\]/gu, "\\$&");
}

/** 小さな DOM 組み立て。文字列連結をやめたので、逃がし漏れが起きない。 */
function el(
  tag: string,
  props: Record<string, string | number> = {}
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "textContent") node.textContent = String(value);
    else if (key === "className") node.className = String(value);
    else node.setAttribute(key, String(value));
  }
  return node;
}
