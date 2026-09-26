// shared/i18n.js
// Чистая логика перевода. Работает и в main, и в renderer.

export function createTranslator(dict, fallback = {}) {
  return function t(key, vars) {
    let str = dict?.[key];
    if (str === undefined) str = fallback?.[key];
    if (str === undefined) return key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.split(`{${k}}`).join(String(v));
      }
    }
    return str;
  };
}

export function resolveLanguage(setting, browserLang) {
  if (setting && setting !== 'auto') return setting;
  const base = String(browserLang || 'en').split('-')[0].toLowerCase();
  return base === 'ru' ? 'ru' : 'en';
}

export const SUPPORTED_LANGS = ['ru', 'en'];