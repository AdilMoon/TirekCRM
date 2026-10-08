'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import messages from './messages.json';
import { formatDate, formatMoney, localeTags, type Locale } from './format';
export type { Locale } from './format';
export function translate(locale: Locale, key: string, values: (string | number)[] = []) {
  const entry = (messages as Record<string, { kk:string; en:string }>)[key];
  const template = locale === 'ru' ? key : entry?.[locale] ?? key;
  return template.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? '{'+index+'}'));
}
const Context = createContext<{ locale:Locale; setLocale:(l:Locale)=>void }>({ locale:'ru', setLocale:()=>{} });
const valid = (s:unknown): s is Locale => s === 'ru' || s === 'kk' || s === 'en';
export function LanguageProvider({ children }: { children:ReactNode }) {
  const [locale, updateLocale] = useState<Locale>('ru');
  function setLocale(next:Locale) { if (!valid(next)) return; updateLocale(next); try { localStorage.setItem('tirek.locale',next); } catch {} }
  useEffect(() => {
    try { const saved=localStorage.getItem('tirek.locale'); if(valid(saved)) updateLocale(saved); } catch {}
    function sync(e:StorageEvent) { if(e.key==='tirek.locale' && valid(e.newValue)) updateLocale(e.newValue); }
    window.addEventListener('storage',sync); return () => window.removeEventListener('storage',sync);
  },[]);
  useEffect(() => { document.documentElement.lang=locale; document.title=translate(locale,'Tirek · опора вашего бизнеса'); },[locale]);
  return <Context.Provider value={{locale,setLocale}}>{children}</Context.Provider>;
}
export function useI18n() {
  const { locale, setLocale } = useContext(Context);
  return { locale:localeTags[locale], language:locale, setLocale,
    t:(key:string, ...values:(string|number)[])=>translate(locale,key,values),
    formatMoney:(value:string|number)=>formatMoney(locale,value),
    formatDate:(value:Date|string,options?:Intl.DateTimeFormatOptions)=>formatDate(locale,value,options),
    dateLabel:(value:string|null)=>value?formatDate(locale,value):translate(locale,'Без срока'),
  };
}
export function LanguageSwitcher() {
  const { language,setLocale,t } = useI18n();
  return <label className="language-switcher"><span className="sr-only">{t('Язык интерфейса')}</span><select aria-label={t('Язык интерфейса')} value={language} onChange={e=>setLocale(e.target.value as Locale)}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label>;
}
