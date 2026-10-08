'use client';
import { useI18n } from '../i18n/provider';
import { useEffect, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Building2 } from 'lucide-react';
import { type OrganizationInput } from '@tirek/contracts';
import { api } from '../lib/api';
import { Field } from '../components/ui';
export function OrganizationSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const { t } = useI18n();

  const [org, setOrg] = useState<OrganizationInput | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<OrganizationInput>('/organization').then(setOrg).catch(e => setError(e.message)); }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!org) return; setBusy(true); setError('');
    try { await api('/organization', { method:'PATCH', body:JSON.stringify(org) }); await onSaved(); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>{t("Реквизиты предприятия")}</h2><p>{t("Используются при создании новых документов.")}</p></div><Building2 size={24} /></div>
    {error && <p className="form-error" role="alert">{t(error)}</p>}
    {org ? <form className="editor-form settings-form" onSubmit={submit}>
      <Field label={t("Название компании *")} name="name" required maxLength={160} value={org.name} onChange={e => setOrg({ ...org, name:e.target.value })} />
      <Field label={t("ИИН/БИН")} name="businessId" inputMode="numeric" pattern="[0-9]{12}" maxLength={12} value={org.businessId} onChange={e => setOrg({ ...org, businessId:e.target.value })} />
      <Field label={t("Адрес")} name="address" maxLength={300} value={org.address} onChange={e => setOrg({ ...org, address:e.target.value })} />
      <div className="form-note">{t("Валюта: KZT · Часовой пояс: Алматы. Изменения применяются к новым актам. Ранее созданные документы сохраняют исходные реквизиты.")}</div>
      <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}{t("Сохранить реквизиты")}</button>
    </form> : !error && <p className="empty">{t("Загрузка…")}</p>}
  </section>;
}
