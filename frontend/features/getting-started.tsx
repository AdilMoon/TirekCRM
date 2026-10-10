'use client';
import { Building2,UserPlus,Users } from 'lucide-react';
import { useI18n } from '../i18n/provider';

export function GettingStarted({onClient,onSettings,onTeam}:{onClient:()=>void;onSettings:()=>void;onTeam:()=>void}){
 const {t}=useI18n();
 const steps=[
  {icon:UserPlus,title:'Добавьте первого клиента',description:'Сохраните контакты, затем создайте заказ и запишите оплату.',action:'Добавить клиента',run:onClient},
  {icon:Building2,title:'Заполните реквизиты',description:'Название, адрес и ИИН/БИН будут использоваться в новых документах.',action:'Открыть настройки',run:onSettings},
  {icon:Users,title:'Пригласите команду',description:'Назначайте сотрудникам задачи и управляйте их доступом.',action:'Открыть команду',run:onTeam},
 ];
 return <section className="panel getting-started" aria-label={t('Первые шаги в Tirek')}>
  <div className="panel-heading"><div><h2>{t('Первые шаги в Tirek')}</h2><p>{t('Пространство готово. Начните с реальных данных вашего бизнеса.')}</p></div></div>
  <div className="getting-started-grid">{steps.map(({icon:Icon,title,description,action,run})=><article key={title}><Icon size={23}/><h3>{t(title)}</h3><p>{t(description)}</p><button className="text-button" onClick={run}>{t(action)}</button></article>)}</div>
 </section>;
}
