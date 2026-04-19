import zh from "../i18n/zh-Hant.json" assert { type: "json" };

type Dict = Record<string, string>;
const dict: Dict = zh as unknown as Dict;

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

export function t(key: string, params?: Record<string, string | number>, fallback?: string): string {
  const raw = dict[key] ?? fallback ?? key;
  return format(raw, params);
}
