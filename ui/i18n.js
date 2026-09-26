// ui/i18n.js
// Клиентский i18n для host UI. Загружает /locales/*.json, применяет к DOM.

(function () {
  'use strict';

  const SUPPORTED = ['ru', 'en'];
  const DEFAULT_LANG = 'en';
  const CACHE = {};

  let current = DEFAULT_LANG;
  let t = (k) => k;
  const listeners = [];

  async function loadLocale(lang) {
    if (CACHE[lang]) return CACHE[lang];
    // cache-busting: добавляем версию, чтобы при апдейте словари перезагружались
    const LOCALE_VERSION = '1.0.7';
    const res = await fetch(`/locales/${lang}.json?v=${LOCALE_VERSION}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`locale ${lang} failed: ${res.status}`);
    CACHE[lang] = await res.json();
    return CACHE[lang];
  }

  function makeTranslator(dict, fallback) {
    return function (key, vars) {
      let str = dict[key];
      if (str === undefined) str = fallback[key];
      if (str === undefined) return key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.split(`{${k}}`).join(String(v));
        }
      }
      return str;
    };
  }

  function applyToDom(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    document.documentElement.setAttribute('lang', current);
  }

  async function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANG;
    const dict = await loadLocale(lang);
    const fallback = lang === 'ru' ? await loadLocale('en') : {};
    current = lang;
    t = makeTranslator(dict, fallback);
    applyToDom();
    listeners.forEach((fn) => { try { fn(lang); } catch {} });
  }

  window.LaklyI18n = {
    t: (key, vars) => t(key, vars),
    get lang() { return current; },
    setLanguage,
    applyToDom,
    onChange(fn) { listeners.push(fn); },
    SUPPORTED,

    // Простая форма плюрализации. Формы передаются массивом:
    //   ru: ['гость', 'гостя', 'гостей']
    //   en: ['guest', 'guests']
    // Внутри смотрит на текущий язык и склоняет по правилам.
    plural(n, forms) {
      if (current === 'ru' && forms.length === 3) {
        const m10 = n % 10;
        const m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return forms[0];
        if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
        return forms[2];
      }
      return n === 1 ? forms[0] : (forms[1] || forms[0]);
    },

    async init(setting) {
      const resolved = (!setting || setting === 'auto')
        ? ((navigator.language || 'en').split('-')[0].toLowerCase() === 'ru' ? 'ru' : 'en')
        : setting;
      await setLanguage(resolved);
    },
  };
})();