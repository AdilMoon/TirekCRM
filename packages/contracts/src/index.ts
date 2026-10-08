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
export const clientSchema = z.object({
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
export const organizationSchema = z.object({
  name: text(160), address: z.string().trim().max(300),
  businessId: z.string().trim().regex(/^(\d{12})?$/, 'ИИН/БИН должен содержать 12 цифр'),
});
export type OrganizationInput = z.infer<typeof organizationSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export const expenseLabels: Record<string, string> = { MATERIALS: 'Материалы', LABOR: 'Исполнители', TRANSPORT: 'Транспорт', RENT: 'Аренда', OTHER: 'Прочее' };

export interface Client extends ClientInput { id: string; createdAt: string; ordersCount: number }
export interface Order {
  id: string; number: number; title: string; status: Stage; version: number; total: string; paid: string; debt: string;
  dueDate: string | null; notes: string; client: ClientInput & { id: string };
  createdAt: string; items: { description: string; quantity: number; unitPrice: string; total: string }[];
}
export interface Movement { id: string; kind: 'INCOME' | 'EXPENSE'; amount: string; description: string; category: string; orderId?:string|null; orderNumber: number | null; createdAt: string }
export interface DocumentRecord { id: string; number: number; kind: 'ACT_DRAFT'; orderId: string; orderNumber: number; clientName: string; total: string; createdAt: string }
export interface DocumentSnapshot {
  organization: { name: string; address: string; businessId: string };
  client: ClientInput; orderNumber: number; title: string; total: string;
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
  entityType: z.enum(['ORDER','CLIENT','ORGANIZATION','PAYMENT','EXPENSE','DOCUMENT','TASK','TEAM']).optional(),
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
 ...periodFields,kind:z.enum(['INCOME','EXPENSE']).optional(),
 category:z.enum(['ORDER_PAYMENT','MATERIALS','LABOR','TRANSPORT','RENT','OTHER']).optional(),
}).strict().refine(value=>!value.from||!value.to||value.from<=value.to,{message:'Начало периода позже окончания'});
export const documentQuerySchema=listQuerySchema.extend(periodFields).strict()
 .refine(value=>!value.from||!value.to||value.from<=value.to,{message:'Начало периода позже окончания'});
export type MovementQuery=z.infer<typeof movementQuerySchema>;
export type DocumentQuery=z.infer<typeof documentQuerySchema>;
export interface MovementPage extends PageResult<Movement> {summary:{received:string;expenses:string;cashFlow:string}}
