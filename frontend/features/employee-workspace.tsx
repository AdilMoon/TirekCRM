'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import type { SessionUser } from '@tirek/contracts';
import { NotificationCenter } from './notifications';
import { AccountSecurity } from './account-security';
import {TelegramConnect} from './telegram-connect';
import { Tasks } from './tasks';
import { WorkTime } from './work-time';
import { Brand } from '../components/ui';
import { useI18n, LanguageSwitcher } from '../i18n/provider';
import { api } from '../lib/api';
import {EmployeeFirstDayCard} from './employee-workflow';
export function EmployeeWorkspace({user,onExit}:{user:SessionUser;onExit:()=>void}) {
 const {t}=useI18n();
 const [error,setError]=useState('');
 const [security,setSecurity]=useState(false);
 const [taskRevision,setTaskRevision]=useState(0);
 const [section,setSection]=useState<'tasks'|'workTime'>('tasks');
 const heading = section === 'tasks' ? 'Мои задачи' : 'Табель';
 async function logout(){try{await api('/auth/logout',{method:'POST'});onExit();}catch(e){if((e as Error&{status?:number}).status===401)onExit();else setError((e as Error).message);}}
 return <div className="employee-shell">
  <header className="topbar">
   <Brand/>
   <div className="topbar-right">
    <button className="text-button" onClick={()=>setSecurity(!security)}>{t(security?heading:'Безопасность аккаунта')}</button>
    <NotificationCenter key={user.id} userId={user.id} onSessionExpired={onExit}/><LanguageSwitcher/>
    <button className="icon-button" aria-label={t('Выйти')} onClick={logout}><LogOut size={18}/></button>
   </div>
  </header>
  <main>
   <div className="page-heading">
    <div><p className="eyebrow">{user.organization.name}</p><h1>{t(security?'Безопасность аккаунта':heading)}</h1><p className="page-subtitle">{user.name} · {t('Сотрудник')}</p></div>
   </div>
   {error&&<p className="alert" role="alert">{t(error)}</p>}
   {security?<><TelegramConnect/><AccountSecurity onSessionEnded={onExit}/></>:<>
    <nav className="employee-work-nav" aria-label={t('Основная навигация')}>
     <button type="button" className={section==='tasks'?'button primary':'button secondary'} aria-current={section==='tasks'?'page':undefined} onClick={()=>setSection('tasks')}>{t('Мои задачи')}</button>
     <button type="button" className={section==='workTime'?'button primary':'button secondary'} aria-current={section==='workTime'?'page':undefined} onClick={()=>setSection('workTime')}>{t('Табель')}</button>
    </nav>
    {section==='tasks'?<><EmployeeFirstDayCard revision={taskRevision} onChanged={()=>setTaskRevision(n=>n+1)} onSessionExpired={onExit}/><Tasks user={user} revision={taskRevision} onSessionExpired={onExit}/><TelegramConnect/></>:<WorkTime owner={false}/>}
   </>}
  </main>
 </div>;
}
