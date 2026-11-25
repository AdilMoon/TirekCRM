'use client';
import {useRef,useState,type KeyboardEvent} from 'react';
import {useI18n} from '../i18n/provider';
import {OrganizationSettings} from './organization-settings';
import {AccountSecurity} from './account-security';
import {PrivacyRequests} from './privacy-requests';
const sections=[{id:'company',label:'Компания'},{id:'access',label:'Доступ'},{id:'privacy',label:'Обращения по данным'}] as const;
type SettingsSection=typeof sections[number]['id'];
export function WorkspaceSettings({onSaved,onSessionEnded}:{onSaved:()=>Promise<void>;onSessionEnded:(expired:boolean)=>void}){
 const {t}=useI18n();const [active,setActive]=useState<SettingsSection>('company');
 const [visited,setVisited]=useState({company:true,access:false,privacy:false});
 const buttons=useRef<(HTMLButtonElement|null)[]>([]);
 function select(id:SettingsSection){setActive(id);setVisited(previous=>({...previous,[id]:true}));}
 function key(event:KeyboardEvent<HTMLButtonElement>,index:number){
  let next=index;
  if(event.key==='ArrowRight')next=(index+1)%sections.length;
  else if(event.key==='ArrowLeft')next=(index+sections.length-1)%sections.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=sections.length-1;
  else return;
  event.preventDefault();select(sections[next].id);buttons.current[next]?.focus();
 }
 return <div className="settings-space">
  <div className="settings-tabs" role="tablist" aria-label={t('Разделы настроек')}>
   {sections.map((section,index)=><button key={section.id} ref={button=>{buttons.current[index]=button;}} type="button" role="tab"
    id={'settings-tab-'+section.id} aria-controls={'settings-panel-'+section.id} aria-selected={active===section.id} tabIndex={active===section.id?0:-1}
    className={'button '+(active===section.id?'primary':'secondary')} onClick={()=>select(section.id)} onKeyDown={event=>key(event,index)}>{t(section.label)}</button>)}
  </div>
  <div role="tabpanel" id="settings-panel-company" aria-labelledby="settings-tab-company" hidden={active!=='company'}>{visited.company&&<OrganizationSettings onSaved={onSaved}/>}</div>
  <div role="tabpanel" id="settings-panel-access" aria-labelledby="settings-tab-access" hidden={active!=='access'}>{visited.access&&<AccountSecurity onSessionEnded={onSessionEnded}/>}</div>
  <div role="tabpanel" id="settings-panel-privacy" aria-labelledby="settings-tab-privacy" hidden={active!=='privacy'}>{visited.privacy&&<PrivacyRequests/>}</div>
 </div>;
}
