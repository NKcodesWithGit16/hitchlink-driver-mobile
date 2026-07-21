import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { en } from './en';
import { ka } from './ka';

const KEY_LANG = 'hl_language';

const DICTS = { en, ka };

const LanguageContext = createContext(null);

// Georgian locale tags look like "ka", "ka-GE" — match on the primary subtag.
function systemDefault() {
  try {
    const tag = Localization.getLocales?.()[0]?.languageCode;
    return tag === 'ka' ? 'ka' : 'en';
  } catch {
    return 'en';
  }
}

// Resolves a dotted key ("more.language") against a dict, falling back to
// English (then the key itself) so a missed translation never renders blank.
function resolve(dict, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(systemDefault());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY_LANG).then((stored) => {
      if (stored === 'en' || stored === 'ka') setLangState(stored);
    }).catch(() => {}).finally(() => setReady(true));
  }, []);

  const setLang = (l) => {
    setLangState(l);
    AsyncStorage.setItem(KEY_LANG, l).catch(() => {});
  };

  const t = useMemo(() => {
    const dict = DICTS[lang] || en;
    return (key, vars) => {
      let str = resolve(dict, key);
      if (str === undefined) str = resolve(en, key);
      if (str === undefined) return key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    };
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t, ready }), [lang, t, ready]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

// Convenience for components that only need the translator.
export function useT() {
  return useContext(LanguageContext).t;
}
