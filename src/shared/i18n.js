(() => {
  const CK = self.COORDKEY;

  const DICTS = {};
  let currentLang = 'zh';

  function register(lang, dict) {
    DICTS[lang] = { ...(DICTS[lang] || {}), ...dict };
  }

  function detectLang() {
    const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh';
    return nav && nav.toLowerCase().startsWith('en') ? 'en' : 'zh';
  }

  function init(lang) {
    currentLang = lang || detectLang();
  }

  function getLang() {
    return currentLang;
  }

  function setLang(lang) {
    currentLang = lang;
  }

  function t(key, params) {
    const dict = DICTS[currentLang] || DICTS.zh || {};
    let text = dict[key];
    if (text == null) {
      const fallback = DICTS.zh || {};
      text = fallback[key];
    }
    if (text == null) return key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (_, name) => {
      return params[name] != null ? String(params[name]) : `{${name}}`;
    });
  }

  CK.i18n = { register, init, getLang, setLang, detectLang, t };
})();
