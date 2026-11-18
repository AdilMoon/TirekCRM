import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { materialListSchema, materialMoveSchema } from '@tirek/contracts';
import { money } from '../../common/money';
import { serializable } from '../../common/transaction';
import { Database } from '../../database/database.service';
import { AuditService, type Actor } from '../audit/audit.service';

@Injectable()
export class MaterialsService {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  list(organizationId: string, query: z.infer<typeof materialListSchema>) {
    const pageSize = 10;
    return this.db.client.$transaction(async tx => {
      if (query.orderId && !await tx.order.findFirst({where:{id:query.orderId,organizationId},select:{id:true}}))
        throw new NotFoundException('Заказ не найден');
      const where: Prisma.MaterialLotWhereInput = { organizationId, expense: { reversal: null },
        name: { contains: query.search, mode: 'insensitive' } };
      const lots = await tx.materialLot.findMany({ where, orderBy: [{createdAt:'desc'}, {expenseId:'desc'}],
        skip:(query.page-1)*pageSize, take:pageSize,
        include:{expense:{select:{amount:true,receipt:{select:{id:true}}}}} });
      const total = await tx.materialLot.count({where});
      const allocated = query.orderId && lots.length ? await tx.materialMovement.groupBy({
        by:['lotId'], where:{organizationId,orderId:query.orderId,lotId:{in:lots.map(l=>l.expenseId)}}, _sum:{quantity:true,costCents:true},
      }) : [];
      const byLot = new Map(allocated.map(row=>[row.lotId,row._sum]));
      return { page:query.page, pageSize, total, pages:Math.ceil(total/pageSize), items:lots.map(lot=>({
        id:lot.expenseId, name:lot.name, quantity:lot.quantity, available:lot.available, availableValue:money(lot.availableCents),
        amount:lot.expense.amount.toFixed(2), receiptId:lot.expense.receipt!.id, createdAt:lot.createdAt,
        allocated:byLot.get(lot.expenseId)?.quantity ?? 0, allocatedValue:money(byLot.get(lot.expenseId)?.costCents ?? 0n),
      })) };
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }

  move(actor: Actor, lotId: string, input: z.infer<typeof materialMoveSchema>) {
    const {organizationId} = actor;
    const {idempotencyKey, quantity} = input;
    const orderId = input.orderId.toLowerCase();
    const issue = input.kind === 'ISSUE';
    const signedQuantity = issue ? quantity : -quantity;
    return serializable(this.db.client, async tx => {
      if (!await tx.user.findFirst({where:{id:actor.id,organizationId,role:'OWNER',isActive:true},select:{id:true}}))
        throw new ForbiddenException('Недостаточно прав');
      const existing = await tx.materialMovement.findUnique({where:{organizationId_idempotencyKey:{organizationId,idempotencyKey}}});
      if (existing) {
        if (existing.lotId !== lotId || existing.orderId !== orderId || existing.quantity !== signedQuantity)
          throw new ConflictException('Ключ операции уже использован');
        return {id:existing.id};
      }
      const lot = await tx.materialLot.findFirst({where:{expenseId:lotId,organizationId,expense:{reversal:null}}});
      if (!lot) throw new NotFoundException('Партия не найдена');
      if (!await tx.order.findFirst({where:{id:orderId,organizationId},select:{id:true}}))
        throw new NotFoundException('Заказ не найден');

      let units = lot.available, value = lot.availableCents;
      if (!issue) {
        const prior = await tx.materialMovement.aggregate({where:{organizationId,orderId,lotId},_sum:{quantity:true,costCents:true}});
        units = prior._sum.quantity ?? 0;
        value = prior._sum.costCents ?? 0n;
      }
      if (quantity > units) throw new ConflictException(issue ? 'Недостаточно материала на складе' : 'Возврат превышает количество в заказе');
      // Apportion the remaining pool in integer tiyn. Its last unit receives the exact remainder.
      const cost = (value * BigInt(quantity) + BigInt(Math.floor(units / 2))) / BigInt(units);
      const costCents = issue ? cost : -cost;
      await tx.materialLot.update({where:{expenseId:lotId},data:{available:{decrement:signedQuantity},availableCents:{decrement:costCents}}});
      const movement = await tx.materialMovement.create({data:{organizationId,lotId,orderId,quantity:signedQuantity,costCents,idempotencyKey},select:{id:true}});
      await this.audit.record(tx,actor,'ORDER',orderId,issue?'MATERIAL_ISSUED':'MATERIAL_RETURNED',
        {lotId,movementId:movement.id,material:lot.name,quantity,amount:money(cost)});
      return movement;
    });
  }
}
