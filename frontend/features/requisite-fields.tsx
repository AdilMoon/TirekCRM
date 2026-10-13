'use client';
import type {ClientInput} from '@tirek/contracts';
import {Field} from '../components/ui';
import {useI18n} from '../i18n/provider';
type Details=Pick<ClientInput,'businessId'|'bankName'|'iban'|'bic'>;
export function RequisiteFields({value,onChange}:{value?:Partial<Details>;onChange?:(field:keyof Details,value:string)=>void}){
 const {t}=useI18n();
 function props(field:keyof Details){return onChange?{value:value?.[field]??'',onChange:(event:React.ChangeEvent<HTMLInputElement>)=>onChange(field,event.target.value)}:{defaultValue:value?.[field]??''};}
 return <fieldset className="requisite-fields"><legend>{t('Идентификация и банковские реквизиты')}</legend>
 <Field label={t('ИИН/БИН')} name="businessId" inputMode="numeric" pattern="[0-9]{12}" maxLength={12} {...props('businessId')}/>
 <Field label={t('Банк')} name="bankName" maxLength={160} {...props('bankName')}/>
 <div className="form-row"><Field label={t('ИИК / IBAN')} name="iban" maxLength={40} spellCheck={false} {...props('iban')}/><Field label={t('БИК')} name="bic" maxLength={8} spellCheck={false} {...props('bic')}/></div>
 <p className="form-note">{t('Реквизиты необязательны для карточки. IBAN проверяется по формату и контрольной сумме; принадлежность счёта проверяйте отдельно.')}</p>
 </fieldset>;
}
