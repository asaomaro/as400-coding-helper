/**
 * 画面側の処理（組の増減）を動かすための最小の DOM 模型。
 *
 * 増減は WebView の script で行うため、そのままではテストできない。
 * jsdom は依存に無いので、renumberGroup が使う分だけを用意する。
 * 実物の描画までは見られないが、番号の振り直しは実際に動かして確かめられる。
 */
export class TinyElement {
  readonly attrs: Record<string, string> = {};
  children: TinyElement[] = [];
  parent?: TinyElement;
  textContent = "";
  innerHTML = "";
  type = "";

  constructor(readonly tag: string) {}

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  set className(value: string) {
    this.attrs.class = value;
  }
  get className(): string {
    return this.attrs.class ?? "";
  }
  appendChild(child: TinyElement): TinyElement {
    this.children = this.children.filter(c => c !== child);
    this.children.push(child);
    child.parent = this;
    return child;
  }
  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(c => c !== this);
    }
  }
  descendants(): TinyElement[] {
    return this.children.flatMap(c => [c, ...c.descendants()]);
  }
  querySelector(selector: string): TinyElement | null {
    return this.descendants().find(e => matches(e, selector)) ?? null;
  }
  querySelectorAll(selector: string): TinyElement[] {
    return this.descendants().filter(e => matches(e, selector));
  }
}

function matches(element: TinyElement, selector: string): boolean {
  return selector.split(", ").some(one => {
    const tags = one.split(",").map(t => t.trim());
    if (tags.every(t => /^[a-z]+$/u.test(t))) {
      return tags.includes(element.tag);
    }
    if (!one.startsWith(".")) return false;

    const className = one.slice(1).split("[")[0];
    if (!element.className.split(" ").includes(className)) return false;

    const attr = /\[([a-z-]+)(\^?)="([^"]+)"\]/u.exec(one);
    if (!attr) return true;
    const value = element.getAttribute(attr[1]) ?? "";
    return attr[2] === "^" ? value.startsWith(attr[3]) : value === attr[3];
  });
}
