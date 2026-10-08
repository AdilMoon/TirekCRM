'use client';
import { useI18n } from '../i18n/provider';
import { useEffect, useRef, type ReactNode } from 'react';
import { Search, X, BriefcaseBusiness } from 'lucide-react';
import { stageLabels, type Stage } from '@tirek/contracts';

export function Brand() {

 return <div className="brand"><span className="brand-mark"><span /><span /><span /></span><span>tirek<span className="brand-dot">.</span></span></div>; }

export function Status({ status }: { status: Stage }) {
  const { t } = useI18n();
 return <span className={`status ${status.toLowerCase()}`}><i />{t(stageLabels[status])}</span>; }

export function Empty({ children }: { children: ReactNode }) {

 return <div className="empty"><BriefcaseBusiness size={28} /><p>{children}</p></div>; }

export function ModalShell({ children, title, onClose, busy = false }: { children: ReactNode; title: string; onClose: () => void; busy?: boolean }) {
  const { t } = useI18n();

  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = old; }; }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="modal-inner"><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label={t("Закрыть")} disabled={busy} onClick={onClose}><X size={20} /></button></div>{children}</div>
  </dialog>;
}

export function Stat({ label, value, detail, icon, featured = false }: { label: string; value: string; detail: string; icon: ReactNode; featured?: boolean }) {


  return <div className={`stat ${featured ? 'featured' : ''}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><span className="stat-detail">{detail}</span></div>;
}

export function SearchBox({ value, setValue, placeholder }: { value: string; setValue: (s: string) => void; placeholder: string }) {
  const { t } = useI18n();
 return <label className="search-box"><Search size={17} /><input aria-label={t("Поиск")} value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} /></label>; }

export function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {

 return <label>{label}<input {...props} /></label>; }
