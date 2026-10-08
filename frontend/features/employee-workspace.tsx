'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import type { SessionUser } from '@tirek/contracts';
import { AccountSecurity } from './account-security';
import { Tasks } from './tasks';
import { Brand } from '../components/ui';
import { useI18n, LanguageSwitcher } from '../i18n/provider';
import { api } from '../lib/api';
export function EmployeeWorkspace({user,onExit}:{user:SessionUser;onExit:()=>void}) {
 const {t}=useI18n();const [error,setError]=useState('');const [security,setSecurity]=useState(false);
 async function logout(){try{await api('/auth/logout',{method:'POST'});onExit();}catch(e){if((e as Error&{status?:number}).status===401)onExit();else setError((e as Error).message);}}
 return <div className="employee-shell"><header className="topbar"><Brand/><div className="topbar-right"><button className="text-button" onClick={()=>setSecurity(!security)}>{t(security?'Мои задачи':'Безопасность аккаунта')}</button><LanguageSwitcher/><button className="icon-button" aria-label={t('Выйти')} onClick={logout}><LogOut size={18}/></button></div></header><main><div className="page-heading"><div><p className="eyebrow">{user.organization.name}</p><h1>{t(security?'Безопасность аккаунта':'Мои задачи')}</h1><p className="page-subtitle">{user.name} · {t('Сотрудник')}</p></div></div>{error&&<p className="alert" role="alert">{t(error)}</p>}{security?<AccountSecurity onSessionEnded={onExit}/>:<Tasks user={user} onSessionExpired={onExit}/>}</main></div>;
}
