import { z } from 'zod';

export const stages = ['NEW', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type Stage = typeof stages[number];
export const stageLabels: Record<Stage, string> = {
  NEW: 'Новый', CONFIRMED: 'Согласован', IN_PROGRESS: 'В работе',
  COMPLETED: 'Выполнен', CANCELLED: 'Отменён',
};
export const moneySchema = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Введите сумму с точностью до тиына')
  .refine(value => /[1-9]/.test(value), 'Сумма должна быть больше нуля');
const text = (max: number) => z.string().trim().min(1, 'Обязательное поле').max(max);
const optionalText = (max:number) => z.string().trim().max(max).refine(value=>!(/[\u0000-\u001f\u007f]/.test(value)), 'Недопустимые символы в реквизитах').default('');
export const businessIdSchema = z.string().trim().regex(/^(\d{12})?$/, 'ИИН/БИН должен содержать 12 цифр').default('');
export const ibanSchema = z.string().trim().max(40).transform(value=>value.replace(/ /g,'').toUpperCase()).refine(value=>{
  if(!value)return true;
  if(!/^KZ\d{5}[A-Z0-9]{13}$/.test(value))return false;
  const digits=(value.slice(4)+value.slice(0,4)).replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  return BigInt(digits)%97n===1n;
}, 'Укажите корректный IBAN Казахстана').default('');
export const bankFields = {
  bankName:optionalText(160), iban:ibanSchema,
  bic:z.string().trim().toUpperCase().regex(/^([A-Z]{4}KZ[A-Z0-9]{2})?$/, 'БИК должен содержать 8 символов банка Казахстана').default(''),
};
export const clientSchema = z.object({
  businessId:businessIdSchema, ...bankFields,
  name: text(160), phone: z.string().trim().max(32).default(''),
  email: z.union([z.literal(''), z.email()]).default(''),
  company: z.string().trim().max(160).default(''),
  address: z.string().trim().max(300).default(''),
});
export const orderSchema = z.object({
  title: text(200), clientId: z.string().uuid(),
  dueDate: z.iso.date().optional(), notes: z.string().trim().max(2000).default(''),
  items: z.array(z.object({ description: text(200), quantity: z.number().int().min(1).max(10000), unitPrice: moneySchema })).min(1).max(100),
});
export const paymentSchema = z.object({ amount: moneySchema, idempotencyKey: z.string().uuid(), note: z.string().trim().max(300).default('') });
export const expenseSchema = z.object({
  amount: moneySchema, description: text(200),
  category: z.enum(['MATERIALS', 'LABOR', 'TRANSPORT', 'RENT', 'OTHER']),
  orderId: z.string().uuid().optional(), idempotencyKey: z.string().uuid(),
});
export const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });
export type ClientInput = z.infer<typeof clientSchema>;
export const updateClientSchema=clientSchema.extend({version:z.number().int().min(1)}).strict();
export type UpdateClientInput=z.infer<typeof updateClientSchema>;
export const organizationSchema = z.object({
  name: text(160), address: z.string().trim().max(300),
  businessId:businessIdSchema, ...bankFields,
});
export type OrganizationInput = z.infer<typeof organizationSchema>;
export interface OrganizationRecord extends OrganizationInput {version:number}
export const updateOrganizationSchema=organizationSchema.extend({version:z.number().int().min(1)}).strict();
export type OrderInput = z.infer<typeof orderSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export const expenseLabels: Record<string, string> = { MATERIALS: 'Материалы', LABOR: 'Исполнители', TRANSPORT: 'Транспорт', RENT: 'Аренда', OTHER: 'Прочее' };

export interface Client extends ClientInput { version:number; id: string; createdAt: string; ordersCount: number }
export interface Order {
  id: string; number: number; title: string; status: Stage; version: number; total: string; paid: string; debt: string;
  dueDate: string | null; notes: string; client: ClientInput & { id: string };
  createdAt: string; items: { description: string; quantity: number; unitPrice: string; total: string }[];
}
export interface Movement { id: string; kind: 'INCOME' | 'EXPENSE' | 'REFUND' | 'EXPENSE_REVERSAL'; sourceId?:string|null; amount: string; description: string; category: string; orderId?:string|null; orderNumber: number | null; createdAt: string }
export type DocumentStatus='DRAFT'|'ANNULLED';
export interface DocumentRecord { status:DocumentStatus; version:number; id: string; number: number; kind: 'ACT_DRAFT' | 'INVOICE_DRAFT'; orderId: string; orderNumber: number; clientName: string; total: string; createdAt: string }
export interface DocumentSnapshot {
  organization: { name: string; address: string; businessId: string; bankName?:string; iban?:string; bic?:string };
  client: Omit<ClientInput,'businessId'|'bankName'|'iban'|'bic'> & Partial<Pick<ClientInput,'businessId'|'bankName'|'iban'|'bic'>>;
  invoice?:{orderVersion:number;dueDate:string|null;note:string;paid:string;amountDue:string;currency:'KZT'};
  orderNumber: number; title: string; total: string;
  items: { description: string; quantity: number; unitPrice: string; total: string }[];
}
export interface Dashboard {
  clientsCount: number; documentsCount:number; activeOrders: number; completedValue: string; received: string; expenses: string; cashFlow: string; outstanding: string;
  pipeline: { status: Stage; count: number; total: string }[];
  monthly: { label: string; income: string; expense: string }[];
  attention: { id: string; number: number; title: string; reason: string }[];
}
export interface SessionUser { id:string; name: string; email: string; organization: { name: string; currency: string }; role: UserRole }

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).refine(value=>!value.includes(String.fromCharCode(0))).default(''),
});
export const orderQuerySchema = listQuerySchema.extend({ status: z.enum(stages).optional() });
export const auditQuerySchema = listQuerySchema.omit({ q:true }).extend({
  entityType: z.enum(['ORDER','CLIENT','ORGANIZATION','PAYMENT','EXPENSE','DOCUMENT','TASK','TEAM','ACCOUNT','PRIVACY_REQUEST']).optional(),
  entityId: z.uuid().optional(),
});
export const updateOrderSchema = orderSchema.extend({ version:z.number().int().min(1) });
export type ListQuery = z.infer<typeof listQuerySchema>;
export type OrderQuery = z.infer<typeof orderQuerySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export interface PageResult<T> { items:T[]; page:number; pageSize:number; total:number; pages:number }
export interface AuditEvent {
 id:string; actorName:string; entityType:string; entityId:string; action:string;
 metadata:Record<string, unknown>; createdAt:string;
}

export const userRoles = ['OWNER','EMPLOYEE'] as const;
export type UserRole = typeof userRoles[number];
export const roleLabels:Record<UserRole,string> = {OWNER:'Владелец компании',EMPLOYEE:'Сотрудник'};
export const taskStatuses = ['TODO','IN_PROGRESS','DONE','CANCELLED'] as const;
export type TaskStatus = typeof taskStatuses[number];
export const taskStatusLabels:Record<TaskStatus,string> = {TODO:'К выполнению',IN_PROGRESS:'В работе',DONE:'Готово',CANCELLED:'Отменено'};
export const invitationSchema = z.object({name:text(160),email:z.email().max(254).transform(value=>value.trim().toLowerCase())}).strict();
export const invitationTokenSchema = z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const acceptInvitationSchema = invitationTokenSchema.extend({password:z.string().min(12).max(128)}).strict();
export const memberAccessSchema = z.object({isActive:z.boolean(),version:z.number().int().min(1)}).strict();
export const taskSchema = z.object({
 title:text(200),description:z.string().trim().max(2000).default(''),
 assigneeId:z.uuid(),orderId:z.uuid().nullable().default(null),dueDate:z.iso.date().nullable().default(null),
}).strict();
export const updateTaskSchema = taskSchema.extend({version:z.number().int().min(1)}).strict();
export const taskStatusSchema = z.object({status:z.enum(taskStatuses),version:z.number().int().min(1)}).strict();
export const taskQuerySchema = listQuerySchema.extend({status:z.enum(taskStatuses).optional(),orderId:z.uuid().optional(),assigneeId:z.uuid().optional()});
export type InvitationInput = z.infer<typeof invitationSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type TaskUpdateInput = z.infer<typeof updateTaskSchema>;
export type TaskQuery = z.infer<typeof taskQuerySchema>;
export interface TeamMember { id:string;name:string;email:string;role:UserRole;isActive:boolean;version:number }
export interface TeamInvitation {id:string;name:string;email:string;expiresAt:string;acceptedAt:string|null;revokedAt:string|null;createdAt:string}
export interface BusinessTask {
 id:string;title:string;description:string;status:TaskStatus;version:number;dueDate:string|null;createdAt:string;updatedAt:string;
 assignee:{id:string;name:string;isActive:boolean};order:{id:string;number:number;title:string}|null;
}

const reportDate=z.iso.date().refine(value=>value>='0001-01-01');
const periodFields={from:reportDate.optional(),to:reportDate.optional(),orderId:z.uuid().optional()};
export const movementQuerySchema=listQuerySchema.extend({
 ...periodFields,kind:z.enum(['INCOME','EXPENSE','REFUND','EXPENSE_REVERSAL']).optional(),
 category:z.enum(['ORDER_PAYMENT','ORDER_REFUND','MATERIALS','LABOR','TRANSPORT','RENT','OTHER']).optional(),
}).strict().refine(value=>!value.from||!value.to||value.from<=value.to,{message:'Начало периода позже окончания'});
export const documentQuerySchema=listQuerySchema.extend({...periodFields,status:z.enum(['DRAFT','ANNULLED']).optional(),kind:z.enum(['ACT_DRAFT','INVOICE_DRAFT']).optional()}).strict()
 .refine(value=>!value.from||!value.to||value.from<=value.to,{message:'Начало периода позже окончания'});
export type MovementQuery=z.infer<typeof movementQuerySchema>;
export type DocumentQuery=z.infer<typeof documentQuerySchema>;
export interface MovementPage extends PageResult<Movement> {summary:{received:string;expenses:string;cashFlow:string}}

export const passwordChangeSchema=z.object({
 currentPassword:z.string().min(1).max(128),newPassword:z.string().min(12).max(128),
}).strict();
export interface AccountSession {id:string;createdAt:string|null;expiresAt:string;userAgent:string;current:boolean}

const registrationName=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
export const registrationSchema=z.object({
 companyName:registrationName(160),ownerName:registrationName(160),
 email:z.string().trim().toLowerCase().pipe(z.email().max(254)),
 password:z.string().min(12).max(128),
}).strict();
export type RegistrationInput=z.infer<typeof registrationSchema>;
export interface RegistrationStatus {registrationEnabled:boolean}

export const taskCommentSchema=z.object({
 body:z.string().trim().min(1).max(2000).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)),
 idempotencyKey:z.uuid(),
}).strict();
export const taskCommentQuerySchema=listQuerySchema.omit({q:true}).strict();
export type TaskCommentInput=z.infer<typeof taskCommentSchema>;
export type TaskCommentQuery=z.infer<typeof taskCommentQuerySchema>;
export interface TaskComment {id:string;body:string;authorId:string;authorName:string;createdAt:string}

export const notificationQuerySchema=listQuerySchema.omit({q:true}).extend({unread:z.enum(['true','false']).default('false')}).strict();
export const readNotificationsSchema=z.object({ids:z.array(z.uuid().transform(value=>value.toLowerCase())).min(1).max(100).refine(ids=>new Set(ids).size===ids.length)}).strict();
export type NotificationQuery=z.infer<typeof notificationQuerySchema>;
export interface AppNotification {
 id:string;kind:'TASK_ASSIGNED'|'TASK_STATUS_CHANGED'|'TASK_COMMENT_ADDED';actorName:string;taskStatus:TaskStatus|null;
 task:{id:string;title:string};createdAt:string;readAt:string|null;
}
export interface NotificationPage extends PageResult<AppNotification> {unreadCount:number}

export const invoiceSchema=z.object({
 orderVersion:z.number().int().min(1),idempotencyKey:z.uuid().transform(value=>value.toLowerCase()),
 dueDate:z.iso.date().refine(value=>value>='0001-01-01').nullable().default(null),
 note:z.string().trim().max(500).refine(value=>!(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)), 'Недопустимые символы в реквизитах').default(''),
}).strict();
export type InvoiceInput=z.infer<typeof invoiceSchema>;

export const annulDocumentSchema=z.object({
 version:z.number().int().min(1).max(2147483647),idempotencyKey:z.uuid().transform(value=>value.toLowerCase()),
 reason:z.string().trim().min(3).max(500).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value)),
}).strict();
export type AnnulDocumentInput=z.infer<typeof annulDocumentSchema>;
export interface PrintableDocument {
 id:string;number:number;createdAt:string;kind:DocumentRecord['kind'];snapshot:DocumentSnapshot;
 status:DocumentStatus;version:number;annulledAt:string|null;annulledByName:string|null;annulmentReason:string|null;
}

export const privacyRequestKinds=['ACCESS','CORRECTION','DELETION','WITHDRAWAL','OTHER'] as const;
export type PrivacyRequestKind=typeof privacyRequestKinds[number];
export const privacyRequestStatuses=['OPEN','IN_PROGRESS','RESOLVED','REJECTED'] as const;
export type PrivacyRequestStatus=typeof privacyRequestStatuses[number];
export const privacyKindLabels:Record<PrivacyRequestKind,string>={ACCESS:'Доступ к данным',CORRECTION:'Исправление данных',DELETION:'Удаление данных',WITHDRAWAL:'Отзыв согласия',OTHER:'Другое обращение'};
export const privacyStatusLabels:Record<PrivacyRequestStatus,string>={OPEN:'Получено',IN_PROGRESS:'В обработке',RESOLVED:'Исполнено',REJECTED:'Отказ с обоснованием'};
const privacyText=(max:number,min=0)=>z.string().trim().min(min).max(max).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value));
const privacyDate=z.iso.date().refine(value=>value>='1900-01-01');
export const privacyRequestSchema=z.object({
 kind:z.enum(privacyRequestKinds),subjectName:privacyText(160,1),contact:privacyText(200).default(''),description:privacyText(1000,3),
 receivedOn:privacyDate,dueOn:privacyDate.nullable().default(null),idempotencyKey:z.uuid().transform(v=>v.toLowerCase()),
}).strict().refine(v=>!v.dueOn||v.dueOn>=v.receivedOn,{message:'Срок не может быть раньше даты получения'});
export const privacyRequestChangeSchema=z.object({
 version:z.number().int().min(1).max(2147483646),status:z.enum(['IN_PROGRESS','RESOLVED','REJECTED']),
 resolution:privacyText(1000).default(''),idempotencyKey:z.uuid().transform(v=>v.toLowerCase()),
}).strict().refine(v=>v.status==='IN_PROGRESS'?v.resolution==='':[...v.resolution].length>=3,{message:'Укажите результат или основание отказа'});
export const privacyRequestQuerySchema=listQuerySchema.extend({q:privacyText(200).default(''),status:z.enum(privacyRequestStatuses).optional(),overdue:z.enum(['true','false']).default('false')}).strict();
export type PrivacyRequestInput=z.infer<typeof privacyRequestSchema>;
export type PrivacyRequestChange=z.infer<typeof privacyRequestChangeSchema>;
export type PrivacyRequestQuery=z.infer<typeof privacyRequestQuerySchema>;
export interface PrivacyRequestSummary {
 id:string;kind:PrivacyRequestKind;status:PrivacyRequestStatus;subjectName:string;receivedOn:string;dueOn:string|null;version:number;createdAt:string;overdue:boolean;
}
export interface PrivacyRequestDetail extends PrivacyRequestSummary {contact:string;description:string;resolution:string;createdByName:string;closedAt:string|null;updatedAt:string}

const adjustmentReason=z.string().trim().min(3).max(500).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value));
export const expenseReversalSchema=z.object({reason:adjustmentReason,idempotencyKey:z.uuid().transform(v=>v.toLowerCase())}).strict();
export const refundSchema=expenseReversalSchema.extend({amount:moneySchema}).strict();
export type RefundInput=z.infer<typeof refundSchema>;
export type ExpenseReversalInput=z.infer<typeof expenseReversalSchema>;
export interface FinancialOperation {
 id:string;kind:'INCOME'|'EXPENSE';amount:string;remaining:string;description:string;createdAt:string;
 corrections:{id:string;amount:string;reason:string;actorName:string;createdAt:string}[];
}
