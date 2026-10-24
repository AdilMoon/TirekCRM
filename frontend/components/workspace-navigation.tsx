'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {useI18n} from '../i18n/provider';
import {ModalShell} from './ui';

// Render only one navigation tree; hidden links must not remain keyboard targets.
export function WorkspaceNavigation({open,onClose,children}:{open:boolean;onClose:()=>void;children:ReactNode}){
 const {t}=useI18n();
 const [mobile,setMobile]=useState(false);
 useEffect(()=>{
  const query=window.matchMedia('(max-width: 760px)');
  function sync(){setMobile(query.matches);if(!query.matches)onClose();}
  sync();query.addEventListener('change',sync);
  return()=>query.removeEventListener('change',sync);
 },[onClose]);
 if(!mobile)return <aside className="sidebar desktop-sidebar">{children}</aside>;
 if(!open)return null;
 return <ModalShell id="workspace-navigation" className="navigation-drawer" title={t('Основная навигация')} onClose={onClose}>
  <div className="mobile-navigation">{children}</div>
 </ModalShell>;
}
