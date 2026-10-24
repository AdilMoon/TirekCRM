'use client';
import {PrivacyRequests} from '../features/privacy-requests';
import { useI18n, LanguageSwitcher } from '../i18n/provider';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, CalendarDays, ChevronRight, CircleHelp, FileText, LayoutDashboard, LogOut, Menu, Plus, Users, Wallet, BriefcaseBusiness, LoaderCircle, CheckCircle2, Clock3, Settings2, History } from 'lucide-react';
import { type SessionUser, type Client, type Order, type Dashboard } from '@tirek/contracts';
import { api } from '../lib/api';
const emptyData = { clients: [] as Client[], orders: [] as Order[], dashboard: null as Dashboard | null };

import { NotificationCenter } from '../features/notifications';
import { GettingStarted } from '../features/getting-started';
import { Brand, Stat, Empty } from '../components/ui';
import { WorkspaceNavigation } from '../components/workspace-navigation';
import { Team } from '../features/team';
import { Tasks } from '../features/tasks';
import { EmployeeWorkspace } from '../features/employee-workspace';
import { Login } from '../features/login';
import { OrdersTable } from '../features/orders-table';
import { FinanceReport, DocumentDirectory } from '../features/reports';
import { MoneyChart } from '../features/money-chart';
import { ClientDirectory, OrderDirectory } from '../features/directories';
import { AuditTrail } from '../features/audit-trail';
import { Editor } from '../features/editor';
import { AccountSecurity } from '../features/account-security';
import { OrganizationSettings } from '../features/organization-settings';
import type { Section, Modal } from '../types/workspace';
export default function Workspace() {
  const { t, formatDate, formatMoney } = useI18n();

const navigation = [
  { id: 'overview', label: t("Обзор"), icon: LayoutDashboard }, { id: 'clients', label: t("Клиенты"), icon: Users },
  { id: 'orders', label: t("Заказы"), icon: BriefcaseBusiness }, { id: 'finances', label: t("Финансы"), icon: Wallet },
  { id: 'documents', label: t("Документы"), icon: FileText },
{ id:'tasks',label:t('Задачи'),icon:CheckCircle2 },
{ id:'team',label:t('Команда'),icon:Users },
{ id:'history', label:t('История действий'), icon:History },
{ id:'settings', label:t("Настройки"), icon:Settings2 },
] as const;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [boot, setBoot] = useState(true);
  const [data, setData] = useState(emptyData);
  const [section, setSection] = useState<Section>('overview');
  const [modal, setModal] = useState<Modal | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenu(false), []);
  async function refresh() {
    setRefreshing(true);
    try {
      const [dashboard, clients, orders] = await Promise.all([
        api<Dashboard>('/dashboard'), api<Client[]>('/clients'), api<Order[]>('/orders'),
      ]);
      setData({ dashboard, clients, orders }); setError('');
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) { setUser(null); setData(emptyData); }
      throw e;
    } finally { setRefreshing(false); }
  }
  useEffect(() => { (async () => {
    try { const session=await api<SessionUser>('/auth/me');setUser(session);if(session.role==='OWNER')await refresh(); }
    catch (e) { if ((e as Error & { status?: number }).status !== 401) setError((e as Error).message); }
    finally { setBoot(false); }
  })(); }, []);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timeout); }, [toast]);
  function navigate(next: Section) { setSection(next); setMobileMenu(false); }
  async function openOrder(order:Pick<Order,'id'>) {
    try { setModal({kind:'details',order:await api<Order>('/orders/'+order.id)}); }
    catch(e){setError((e as Error).message);}
  }
  async function saved(message: string) {
    setModal(null); setToast(message);
    try { await refresh(); setUser(await api<SessionUser>('/auth/me')); } catch { setError(t("Изменения сохранены, но не удалось обновить экран. Нажмите «Обновить».")); }
  }
  if (boot) return <div className="boot"><Brand /><LoaderCircle className="spin" /><p>{t("Открываем рабочее пространство…")}</p></div>;
  if (!user) return <Login initialError={t(error)} onLogin={async () => { const session=await api<SessionUser>('/auth/me');setUser(session);setSection('overview'); try { if(session.role==='OWNER')await refresh(); } catch (e) { setError((e as Error).message); } }} />;
  if(user.role==='EMPLOYEE')return <EmployeeWorkspace user={user} onExit={()=>{setUser(null);setData(emptyData);setError('');}}/>;
  const dashboard = data.dashboard;
  const selectedNav = navigation.find(n => n.id === section)!;
  const day = formatDate(new Date(), { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Asia/Almaty' });
  return <div className="app-shell">
    <WorkspaceNavigation open={mobileMenu} onClose={closeMobileMenu}>
      <Brand />
      <div className="workspace-label"><span className="workspace-avatar">{user.organization.name.split(/\s+/).slice(0,2).map(word => word[0]).join("")}</span><div><strong>{user.organization.name}</strong><span>{t("Рабочее пространство")}</span></div></div>
      <p className="nav-caption">{t("УПРАВЛЕНИЕ БИЗНЕСОМ")}</p>
      <nav aria-label={t("Основная навигация")}>{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{id === 'orders' && !!dashboard?.activeOrders && <small>{dashboard.activeOrders}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-note"><span className="live-dot" /><div><strong>{t("Первый шаг к порядку")}</strong><p>{t("Клиенты, работа и деньги.")}<br />{t("Всё связано между собой.")}</p></div></div><button className="help-button" onClick={() => { closeMobileMenu(); setModal({ kind: 'about' }); }}><CircleHelp size={18} />  {t("О проекте")} <ArrowUpRight size={15} /></button>
      <div className="profile"><span className="user-avatar">{t("В")}</span><div><strong>{user.name}</strong><span>{t("Владелец компании")}</span></div><button aria-label={t("Выйти")} className="icon-button" onClick={async () => { try { await api('/auth/logout', { method: 'POST' }); setUser(null); setData(emptyData); } catch (e) { setError((e as Error).message); } }}><LogOut size={17} /></button></div></div>
    </WorkspaceNavigation>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label={t("Меню")} aria-expanded={mobileMenu} aria-haspopup="dialog" aria-controls={mobileMenu ? "workspace-navigation" : undefined} onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22} /></button><span>{t("Рабочее пространство")}</span><ChevronRight size={14} /><strong>{selectedNav.label}</strong></div><div className="topbar-right"><NotificationCenter key={user.id} userId={user.id} onSessionExpired={()=>{setUser(null);setData(emptyData);}}/><LanguageSwitcher /><span className="demo-pill">{user.organization.currency}</span><span className="top-date"><CalendarDays size={16} />{formatDate(new Date(), { day: 'numeric', month: 'short', timeZone: 'Asia/Almaty' })}</span></div></header>
    <main>
      {error && <div className="alert" role="alert">{t(error)}<button onClick={() => refresh().catch(e => setError(e.message))}>{t("Обновить")}</button></div>}
      <div className="page-heading"><div><p className="eyebrow">{section === 'overview' ? day : t("{0} / РАБОЧЕЕ ПРОСТРАНСТВО", user.organization.name)}</p><h1>{section === 'overview' ? t("Всё под контролем.") : selectedNav.label}</h1><p className="page-subtitle">{({ overview: t("Ваш бизнес в деталях. Главное — на одном экране."), clients: t("Люди и компании, с которыми вы работаете."), orders: t("От первого обращения до выполненной работы."), finances: t("Поступления и расходы без потерянных деталей."), documents: t("Документы, связанные с вашими заказами."), tasks:t('Договорённости, исполнители и сроки в одном месте.'),team:t('Люди, с которыми вы строите бизнес.'),history:t('Кто и когда изменил данные'), settings:t("Данные компании для вашего пространства и документов.") })[section]}</p></div>
      {!['settings','history','tasks','team'].includes(section) && <div className="heading-actions">{section==='documents'&&<button className="button secondary" onClick={()=>setModal({kind:'invoice'})}><Plus size={17}/>{t('Создать счёт')}</button>}{section === 'finances' && <button className="button secondary" onClick={() => setModal({ kind: 'payment' })}><Plus size={17} />{t("Оплата")}</button>}<button className="button primary" onClick={() => setModal({ kind: section === 'clients' ? 'client' : section === 'finances' ? 'expense' : section === 'documents' ? 'document' : 'order' })}><Plus size={18} />{section === 'clients' ? t("Новый клиент") : section === 'finances' ? t("Добавить расход") : section === 'documents' ? t("Создать акт") : t("Новый заказ")}</button></div>}</div>
      {section === 'overview' && dashboard && <>
        {dashboard.clientsCount===0&&<GettingStarted onClient={()=>setModal({kind:'client'})} onSettings={()=>navigate('settings')} onTeam={()=>navigate('team')}/>}
        <div className="section-meta"><span><span className="live-dot" />{t("Сводка бизнеса")}</span><span>{t("За всё время · KZT")}</span></div>
        <div className="stats-grid">
          <Stat label={t("Получено от клиентов")} value={formatMoney(dashboard.received)} icon={<ArrowDownLeft size={19} />} detail={t("Фактически записанные оплаты")} />
          <Stat label={t("Расходы")} value={formatMoney(dashboard.expenses)} icon={<ArrowUpRight size={19} />} detail={t("Все записанные расходы")} />
          <Stat label={t("Денежный поток")} value={formatMoney(dashboard.cashFlow)} icon={<Wallet size={19} />} detail={t("Поступления минус расходы")} featured />
          <Stat label={t("Осталось получить")} value={formatMoney(dashboard.outstanding)} icon={<Clock3 size={19} />} detail={t("По действующим и выполненным заказам")} />
        </div>
        <div className="dashboard-middle"><section className="panel chart-panel"><div className="panel-heading"><div><h2>{t("Движение денег")}</h2><p>{t("Как меняются поступления и расходы")}</p></div><span className="subtle-pill">{t("6 месяцев")}</span></div><MoneyChart data={dashboard.monthly} /><div className="chart-legend"><span><i className="income-dot" />{t("Поступления")}</span><span><i className="expense-dot" />{t("Расходы")}</span><small>{t("По датам операций · Алматы")}</small></div></section>
        <section className="panel attention-panel"><div className="panel-heading"><div><h2>{t("Требует внимания")} <span className="count-pill">{dashboard.attention.length}</span></h2><p>{t("Ближайшие шаги по заказам")}</p></div></div><div className="attention-list">{dashboard.attention.length ? dashboard.attention.slice(0,4).map((item, i) => <button key={item.id} className="attention-item" onClick={async () => { try { setModal({kind:'details',order:await api<Order>('/orders/'+item.id)}); } catch(e){setError((e as Error).message);} }}><span className={`attention-icon a${i}`}><Clock3 size={17} /></span><span><strong>{item.title}</strong><small>{t(item.reason)}</small></span><ChevronRight size={17} /></button>) : <Empty>{t("Все текущие заказы завершены")}</Empty>}</div><div className="attention-foot"><CheckCircle2 size={16} />{t("Подсказки по срокам и статусам")}</div></section></div>
        <section className="panel"><div className="panel-heading"><div><h2>{t("Последние заказы")}</h2><p>{t("Каждое обращение на своём месте")}</p></div><button className="text-button" onClick={() => navigate('orders')}>{t("Все заказы")} <ArrowRight size={16} /></button></div><OrdersTable orders={data.orders.slice(0,5)} onSelect={openOrder} /></section>
        <div className="bottom-summary"><span><Users size={16} /><strong>{dashboard.clientsCount}</strong>  {t("клиентов в базе")}</span><span><BriefcaseBusiness size={16} /><strong>{dashboard.activeOrders}</strong>  {t("заказов в работе")}</span><span><FileText size={16} /><strong>{dashboard.documentsCount}</strong>  {t("документов в базе")}</span></div>
      </>}
      {section === 'orders' && <OrderDirectory revision={data} onSelect={openOrder}/>}
      {section === 'clients' && <ClientDirectory revision={data} onSelect={client=>setModal({kind:'client',client})}/>}
      {section === 'tasks' && <Tasks user={user}/>}
      {section === 'team' && <Team/>}
      {section === 'history' && <AuditTrail revision={data}/>}
      {section === 'finances' && <FinanceReport revision={data} onOrder={id=>openOrder({id})}/>}
      {section === 'documents' && <DocumentDirectory revision={data}/>}
      {section === 'settings' && <div className="settings-space"><PrivacyRequests/><OrganizationSettings onSaved={async () => { setUser(await api<SessionUser>('/auth/me')); setToast(t("Реквизиты сохранены")); }} /><AccountSecurity onSessionEnded={expired=>{setUser(null);setData(emptyData);setError(expired?'Сессия истекла. Войдите снова':'');}}/></div>}
<footer className="page-footer"><span>{t("Tirek · опора вашего бизнеса")}</span><span>{refreshing ? t("Обновляем данные…") : t("Данные вашего рабочего пространства")}</span></footer>
    </main></div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} />{t(toast)}</div>}
    {modal && <Editor key={`${modal.kind}-${modal.order?.id ?? modal.client?.id ?? ''}`} modal={modal} close={() => setModal(null)} saved={saved} setModal={setModal} />}
  </div>;
}
