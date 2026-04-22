import { Markup } from 'telegraf';
import { prisma } from '../database';
import { getChatId, buildOrderMessage, sendOrEditOrderMessage } from '../utils';
import { isAdminOrSO } from '../database';

export async function showStatusOrbit(ctx: any) {
  const chatId = getChatId(ctx);
  const orders = await prisma.order.findMany({
    where: { status: 'done', chatId: chatId },
    orderBy: { createdAt: 'desc' }
  });
  
  if (orders.length === 0) {
    await ctx.reply('Tidak ada orbit aktif di grup ini.');
    return;
  }
  let msg = `Status Orbit (Aktif: ${orders.length})\n\n`;
  for (const order of orders) {
    msg += `🟢 ${order.kodePerangkat}\n`;
  }
  await ctx.reply(msg);
}

export async function showStatusCommand(ctx: any) {
  const chatId = getChatId(ctx);
  const orders = await prisma.order.findMany({
    where: { status: 'done', chatId: chatId },
    orderBy: { createdAt: 'desc' }
  });
  
  if (orders.length === 0) {
    await ctx.reply('Tidak ada orbit aktif di grup ini.');
    return;
  }
  let msg = `Status Orbit (Aktif: ${orders.length})\n\n`;
  for (const order of orders) {
    msg += `🟢 ${order.kodePerangkat}\n`;
  }
  await ctx.reply(msg);
}

export async function showRollbackMenu(ctx: any) {
  const chatId = getChatId(ctx);
  const orders = await prisma.order.findMany({
    where: { status: 'done', chatId: chatId },
    orderBy: { createdAt: 'desc' }
  });
  
  if (orders.length === 0) {
    await ctx.reply('Tidak ada orbit aktif untuk di-rollback di grup ini.');
    return;
  }
  const buttons = [];
  for (const order of orders) {
    buttons.push(Markup.button.callback(order.kodePerangkat, `rollback_select_${order.id}`));
  }
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  await ctx.reply('Pilih orbit yang ingin di-rollback:', Markup.inlineKeyboard(rows));
}

export async function handleRollbackSelect(ctx: any, orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const currentChatId = getChatId(ctx);
  
  if (!order) {
    await ctx.answerCbQuery('Order tidak ditemukan');
    return;
  }
  
  if (order.chatId !== currentChatId) {
    await ctx.answerCbQuery('❌ Data ini dari grup lain!');
    return;
  }
  
  await ctx.answerCbQuery(`Orbit ${order.kodePerangkat} dipilih`);
  await prisma.order.update({
    where: { id: orderId },
    data: { status: 'rollback', acceptedBy: null, acceptedAt: null, completedBy: null, completedAt: null }
  });
  const msg = buildOrderMessage(order, 'Selesai - Siap di-rollback');
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✔ Selesai', `rollback_complete_${order.id}`),
     Markup.button.callback('✖ Batal', `rollback_cancel_${order.id}`)]
  ]);
  await ctx.reply(msg, keyboard);
}

export async function handleRollbackComplete(ctx: any, orderId: number) {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const currentChatId = getChatId(ctx);
  
  if (!order) {
    await ctx.answerCbQuery('Order tidak ditemukan');
    return;
  }
  
  if (order.chatId !== currentChatId) {
    await ctx.answerCbQuery('❌ Data ini dari grup lain!');
    return;
  }
  
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'rollback', completedBy: ctx.from.username, completedAt: new Date() }
  });
  
  await ctx.answerCbQuery(`Rollback selesai, orbit ${updatedOrder.kodePerangkat} di-rollback`);
  await ctx.editMessageText(`✅ Rollback selesai. Orbit ${updatedOrder.kodePerangkat} telah di-rollback.`);
}

export async function handleRollbackCancel(ctx: any, orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const currentChatId = getChatId(ctx);
  
  if (!order) {
    await ctx.answerCbQuery('Order tidak ditemukan');
    return;
  }
  
  if (order.chatId !== currentChatId) {
    await ctx.answerCbQuery('❌ Data ini dari grup lain!');
    return;
  }
  
  await prisma.order.update({ where: { id: orderId }, data: { status: 'done' } });
  await ctx.answerCbQuery('Rollback dibatalkan');
  await ctx.editMessageText(`❌ Rollback dibatalkan. Orbit ${order.kodePerangkat} tetap aktif.`);
}

export async function handleRollbackFromButton(ctx: any, orderId: number) {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const currentChatId = getChatId(ctx);
  
  if (!order) {
    await ctx.answerCbQuery('Order tidak ditemukan');
    return;
  }
  
  if (order.chatId !== currentChatId) {
    await ctx.answerCbQuery('❌ Data ini dari grup lain!');
    return;
  }
  
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'rollback', completedBy: ctx.from.username, completedAt: new Date() }
  });
  await ctx.answerCbQuery('Order di-rollback');
  await sendOrEditOrderMessage(ctx, updatedOrder, 'rollback', ctx.from.username);
  await ctx.reply(`Order ${order.orderNumber} telah di-rollback.`);
}