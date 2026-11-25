'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {QrCode,Upload,Download,Trash2,Eye,EyeOff,ImagePlus,LoaderCircle} from 'lucide-react';
import type {OrderPassport,PassportLinkResult} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {api} from '../lib/api';
import {ModalShell} from '../components/ui';
async function compressPhoto(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10000000)throw new Error('Выберите JPEG, PNG или WebP до 10 МБ');
 const url=URL.createObjectURL(file),image=new Image();
 try{
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Не удалось обработать фото'));image.src=url;});
  const canvas=document.createElement('canvas');
  for(const width of [1200,900,600]){
   const scale=Math.min(1,width/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
   const data=canvas.toDataURL('image/jpeg',.78).split(',')[1];if(data.length<=370000)return data;
  }
  throw new Error('Фото слишком большое после обработки');
 }finally{URL.revokeObjectURL(url);}
}
export function OrderPassportManager({id,close}:{id:string;close:()=>void}){
 const {t,formatDate}=useI18n();
 const [data,setData]=useState<OrderPassport|null>(null),[link,setLink]=useState<PassportLinkResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [phase,setPhase]=useState('BEFORE'),[file,setFile]=useState<File|null>(null),[retry,setRetry]=useState(0);
 const [review,setReview]=useState<{id:string;orderVersion:number}|null>(null);
 const [approved,setApproved]=useState(false);
 const photoRequest=useRef<{image:string;phase:string;shared:false;idempotencyKey:string}|null>(null);
 const fileInput=useRef<HTMLInputElement>(null);
 const passportPath='/orders/'+id+'/passport';
 useEffect(()=>{let active=true;setData(null);setError('');api<OrderPassport>(passportPath).then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[passportPath,retry]);
 async function action(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();setData(await api<OrderPassport>('/orders/'+id+'/passport'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function upload(e:FormEvent){e.preventDefault();if(!file)return;await action(async()=>{
  if(!photoRequest.current)photoRequest.current={image:await compressPhoto(file),phase,shared:false,idempotencyKey:crypto.randomUUID()};
  await api(passportPath+'/photos',{method:'POST',body:JSON.stringify(photoRequest.current)});
  photoRequest.current=null;setFile(null);
  if(fileInput.current)fileInput.current.value='';
 });}
 function setVisibility(photoId:string,shared:boolean,orderVersion:number){
  setReview(null);
  setApproved(false);
  return action(()=>api(passportPath+'/photos/'+photoId+'/visibility',{
   method:'PATCH',body:JSON.stringify({shared,orderVersion}),
  }));
 }
 const photoCount=data?.photoCount??data?.photos.length??0;
 return <ModalShell title={t('QR-паспорт заказа')} onClose={close} busy={busy} className="passport-modal">
  <p className="form-note">{t('По ссылке видны название, статус, срок и выбранные фото. Ссылку сможет открыть любой, у кого она есть.')}</p>
  {data?.canPublish&&<p className="form-note">{t('В завершённом заказе с объектом получатель ссылки также может отправить обращение на обслуживание.')}</p>}
  {error&&<p className="form-error" role="alert">{t(error)} <button className="text-button" disabled={busy} onClick={()=>{setReview(null);setApproved(false);setRetry(v=>v+1);}}>{t('Обновить')}</button></p>}
  {!data?(!error&&<p role="status">{t('Загрузка…')}</p>):<>
   {data.confirmedAt&&<p className="passport-accepted" role="status">{t('Клиент подтвердил выполнение')} · {formatDate(data.confirmedAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p>}
   {data.canPublish&&<><div className="passport-link-actions"><button className="button primary" disabled={busy} onClick={()=>action(async()=>{setLink(await api<PassportLinkResult>('/orders/'+id+'/passport/link',{method:'POST'}));})}><QrCode size={18}/>{t(data.active?'Выпустить новую ссылку':'Создать QR-паспорт')}</button>{data.active&&<button className="button secondary" disabled={busy} onClick={()=>action(async()=>{await api('/orders/'+id+'/passport/link',{method:'DELETE'});setLink(null);})}>{t('Отозвать ссылку')}</button>}</div>
   <p className="form-note">{data.active?t('Ссылка действует до {0}',formatDate(data.expiresAt!)):t('Публичная ссылка не активна')}. {t('Новая ссылка отключает предыдущую.')}</p></>}
   {link&&<div className="passport-share"><img src={link.qr} width={220} height={220} alt={t('QR-код паспорта заказа')}/><div><label>{t('Ссылка для клиента')}<input readOnly value={link.url}/></label><div className="passport-link-actions"><a className="button secondary" href={link.url} target="_blank" rel="noreferrer">{t('Открыть паспорт')}</a><a className="button secondary" href={link.qr} download={'tirek-passport-'+data.number+'.png'}><Download size={16}/>{t('Скачать QR')}</a></div>{new URL(link.url).hostname==='localhost'&&<p className="form-note">{t('Локальная ссылка открывается на этом компьютере. Для телефона нужен размещённый HTTPS-сайт.')}</p>}</div></div>}
   <section className="passport-gallery">
    <div className="passport-gallery-heading"><h3><ImagePlus size={18} aria-hidden="true"/>{t('Фото до и после')}</h3><span>{t('Фото в заказе: {0} из 6',photoCount)}</span></div>
    <p className="form-note">{t(data.canPublish?'После загрузки проверьте снимок и решите, можно ли показать его по ссылке.':'Вы видите свои снимки. Публикацией управляет владелец компании.')}</p>
    {data.photos.length>0&&<div className="passport-photos passport-photo-manager">
     {data.photos.map(photo=><figure key={photo.id}>
      <img src={photo.image} alt={t(photo.phase==='BEFORE'?'До выполнения':'После выполнения')}/>
      <figcaption>
       <div className="passport-photo-heading">
        <strong>{t(photo.phase==='BEFORE'?'До выполнения':'После выполнения')}</strong>
        <span className="passport-photo-visibility" data-shared={photo.shared}>
         {photo.shared?<Eye size={14} aria-hidden="true"/>:<EyeOff size={14} aria-hidden="true"/>}
         {t(photo.shared?(data.active?'Доступно по ссылке':'Выбрано для публикации'):'Только в CRM')}
        </span>
       </div>
       <div className="passport-photo-actions">
        {data.canPublish&&<button type="button" className="button secondary" disabled={busy} onClick={()=>{
         if(photo.shared){void setVisibility(photo.id,false,data.orderVersion);return;}
         setReview({id:photo.id,orderVersion:data.orderVersion});setApproved(false);
        }}>{t(photo.shared?'Скрыть с паспорта':'Показать по ссылке')}</button>}
        {photo.canDelete&&<button type="button" className="icon-button" aria-label={t('Удалить фото')} disabled={busy} onClick={()=>{
         setReview(null);setApproved(false);void action(()=>api(passportPath+'/photos/'+photo.id,{method:'DELETE'}));
        }}><Trash2 size={16}/></button>}
       </div>
       {data.canPublish&&review?.id===photo.id&&!photo.shared&&<div className="passport-photo-review">
        <label className="passport-check"><input type="checkbox" checked={approved} disabled={busy} onChange={e=>setApproved(e.target.checked)}/>{t('Я проверил снимок и могу открыть его для получателей ссылки.')}</label>
        <div className="passport-photo-actions">
         <button type="button" className="button primary" disabled={busy||!approved} onClick={()=>setVisibility(photo.id,true,review.orderVersion)}>{t('Подтвердить публикацию фото')}</button>
         <button type="button" className="button secondary" disabled={busy} onClick={()=>{setReview(null);setApproved(false);}}>{t('Отмена')}</button>
        </div>
       </div>}
      </figcaption>
     </figure>)}
    </div>}
    {photoCount<6&&<form className="editor-form passport-upload" onSubmit={upload}>
     <div className="form-row">
      <label>{t('Этап фото')}<select aria-label={t('Этап фото')} value={phase} disabled={busy} onChange={e=>{setPhase(e.target.value);photoRequest.current=null;}}><option value="BEFORE">{t('До выполнения')}</option><option value="AFTER">{t('После выполнения')}</option></select></label>
      <label>{t('Фотография')}<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);photoRequest.current=null;}}/></label>
     </div>
     <button className="button secondary" disabled={busy||!file}>{busy?<LoaderCircle size={16} className="spin"/>:<Upload size={16}/>} {t('Загрузить фото')}</button>
    </form>}
   </section>
   <p className="form-note">{t('Подтверждение относится к текущей версии заказа и фото. После изменений клиенту нужно подтвердить работу снова.')}</p>
  </>}
 </ModalShell>;
}
