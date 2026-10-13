'use client';
import { useI18n } from '../i18n/provider';
import { useEffect, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Building2 } from 'lucide-react';
import { type OrganizationRecord } from '@tirek/contracts';
import { RequisiteFields } from './requisite-fields';
import { api } from '../lib/api';
import { Field } from '../components/ui';
export function OrganizationSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const { t } = useI18n();

  const [org, setOrg] = useState<OrganizationRecord | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<OrganizationRecord>('/organization').then(setOrg).catch(e => setError(e.message)); }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!org || busy) return; setBusy(true); setError('');
    try { const updated=await api<OrganizationRecord>('/organization', { method:'PATCH', body:JSON.stringify(org) }); setOrg(updated); await onSaved(); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>{t("Реквизиты предприятия")}</h2><p>{t("Используются при создании новых документов.")}</p></div><Building2 size={24} /></div>
    {error && <p className="form-error" role="alert">{t(error)}</p>}
    {org ? <form className="editor-form settings-form" onSubmit={submit}><fieldset className="invoice-fields" disabled={busy}>
      <Field label={t("Название компании *")} name="name" required maxLength={160} value={org.name} onChange={e => setOrg({ ...org, name:e.target.value })} />
      <RequisiteFields value={org} onChange={(field,value)=>setOrg({...org,[field]:value})}/>
      <Field label={t("Адрес")} name="address" maxLength={300} value={org.address} onChange={e => setOrg({ ...org, address:e.target.value })} />
      <div className="form-note">{t("Валюта: KZT · Часовой пояс: Алматы. Изменения применяются к новым документам. Ранее созданные документы сохраняют исходные реквизиты.")}</div>
      <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}{t("Сохранить реквизиты")}</button>
    </fieldset></form> : !error && <p className="empty">{t("Загрузка…")}</p>}
  </section>;
}
