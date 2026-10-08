'use client';
import { useEffect, useState } from 'react';
import type { PageResult } from '@tirek/contracts';
import { api } from './api';
export function usePage<T,R extends PageResult<T>=PageResult<T>>(path:string,query:string,revision:unknown=0) {
 const [result,setResult]=useState<R|null>(null);
 const [error,setError]=useState('');
 const [errorStatus,setErrorStatus]=useState<number|undefined>();
 const [busy,setBusy]=useState(true);
 const [attempt,retry]=useState(0);
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  setBusy(true);setError('');setErrorStatus(undefined);setResult(null);
  const timer=setTimeout(()=>{
   api<R>(path+'?'+query,{signal:controller.signal})
    .then(data=>{if(active)setResult(data);})
    .catch(e=>{if(active){setError(e.message);setErrorStatus(e.status);}})
    .finally(()=>{if(active)setBusy(false);});
  },200);
  return ()=>{active=false;clearTimeout(timer);controller.abort();};
 },[path,query,revision,attempt]);
 return {result,error,errorStatus,busy,retry:()=>retry(n=>n+1)};
}
