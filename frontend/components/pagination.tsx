'use client';
import type { PageResult } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
export function Pagination({result,page,setPage,busy}:{result:PageResult<unknown>|null;page:number;setPage:(page:number)=>void;busy:boolean}) {
 const {t}=useI18n();
 return <div className="pagination">
  <span>{result?t('Страница {0} из {1} · Всего: {2}',page,Math.max(1,result.pages),result.total):t('Загрузка…')}</span>
  <div><button type="button" className="button secondary" disabled={busy||page===1} onClick={()=>setPage(page-1)}>{t('Назад')}</button>
  <button type="button" className="button secondary" disabled={busy||!result||page>=result.pages} onClick={()=>setPage(page+1)}>{t('Далее')}</button></div>
 </div>;
}
