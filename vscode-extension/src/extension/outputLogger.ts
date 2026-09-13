import * as vscode from "vscode";

export const OUTPUT_CHANNEL_NAME = "AS400 Coding Helper";

type LogLevel = "INFO" | "WARN" | "ERROR";
type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

let outputChannel: vscode.OutputChannel | undefined;
let originalConsole: Pick<Console, "log" | "warn" | "error"> | undefined;

/**
 * 拡張機能の診断ログを Output パネルへ集約する。既存の `[rpgClSupport]` ログは
 * Extension Host 側にも残しつつ、このチャネルにも複写する。
 */
export function initializeOutputLogger(context: vscode.ExtensionContext): void {
  if (outputChannel) {
    return;
  }
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  outputChannel = channel;
  installConsoleForwarder();
  context.subscriptions.push({
    dispose: () => {
      if (outputChannel === channel) {
        outputChannel = undefined;
        restoreConsole();
      }
      channel.dispose();
    }
  });
  logInfo("拡張機能を有効化しました。");
}

export function logInfo(message: string, fields?: LogFields): void {
  write("INFO", message, fields);
}

export function logWarning(message: string, fields?: LogFields): void {
  write("WARN", message, fields);
}

export function logError(message: string, error?: unknown, fields?: LogFields): void {
  const diagnostic = diagnosticOf(error);
  write("ERROR", diagnostic ? `${message}: ${diagnostic}` : message, fields);
}

/** 失敗時に利用者がその場で詳細を確認できるよう Output パネルを開く。 */
export function showOutput(): void {
  outputChannel?.show(true);
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const suffix = fields
    ? Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ")
    : "";
  outputChannel?.appendLine(`${new Date().toISOString()} [${level}] ${message}${suffix ? ` ${suffix}` : ""}`);
}

function diagnosticOf(error: unknown): string | undefined {
  if (error === undefined || error === null) {
    return undefined;
  }
  if (typeof error === "object" && "diagnostic" in error && typeof error.diagnostic === "string") {
    return cleanDiagnostic(error.diagnostic);
  }
  if (error instanceof Error) {
    return cleanDiagnostic(error.message);
  }
  return cleanDiagnostic(String(error));
}

function cleanDiagnostic(value: string): string | undefined {
  const normalized = value.replace(/[\r\n\t]+/gu, " ").trim();
  return normalized ? normalized.slice(0, 4_000) : undefined;
}

function installConsoleForwarder(): void {
  if (originalConsole) {
    return;
  }
  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };
  console.log = (...args: unknown[]) => {
    originalConsole?.log(...args);
    forwardConsole("INFO", args);
  };
  console.warn = (...args: unknown[]) => {
    originalConsole?.warn(...args);
    forwardConsole("WARN", args);
  };
  console.error = (...args: unknown[]) => {
    originalConsole?.error(...args);
    forwardConsole("ERROR", args);
  };
}

function restoreConsole(): void {
  if (!originalConsole) {
    return;
  }
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  originalConsole = undefined;
}

function forwardConsole(level: LogLevel, args: unknown[]): void {
  const [first] = args;
  if (typeof first !== "string" || !first.startsWith("[rpgClSupport]")) {
    return;
  }
  // 既存ログの追加引数には、編集中のソース断片が含まれる場合がある。
  // Output パネルへはイベント名だけを転記し、ソース本文や入力値を残さない。
  write(level, first.replace(/^\[rpgClSupport\]\s*/u, "").trim());
}
