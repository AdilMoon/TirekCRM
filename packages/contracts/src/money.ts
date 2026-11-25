import {z} from 'zod';
export const moneySchema=z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Введите сумму с точностью до тиына')
 .refine(value=>/[1-9]/.test(value), 'Сумма должна быть больше нуля');
