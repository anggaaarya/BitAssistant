import { Markup } from 'telegraf';
import { prisma } from './database';

export function isPrivateChat(ctx: any): boolean {
  return ctx.chat?.type === 'private';
}

export function isGroupChat(ctx: any): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

export function getChatId(ctx: any): bigint {
  return BigInt(ctx.chat?.id || 0);
}

export async function generateOrderNumber(chatId: bigint): Promise<string> {
  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, '0')}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear()}`;
  
  const lastOrder = await prisma.order.findFirst({
    where: {
      chatId: chatId,
      orderNumber: { startsWith: `OB-${dateStr}-` }
    },
    orderBy: { orderNumber: 'desc' }
  });
  
  let nextNumber = 1;
  if (lastOrder) {
    const lastNum = parseInt(lastOrder.orderNumber.split('-')[2] || '0');
    nextNumber = lastNum + 1;
  }
  return `OB-${dateStr}-${nextNumber.toString().padStart(3, '0')}`;
}

export function parseRequestMessage(text: string): { 
  success: boolean; 
  error?: string; 
  data?: { customer: string; kodePerangkat: string; noTiket: string; layanan: string; witelSto: string; datekMetro: string; } 
} {
  const lines = text.split('\n');
  let noTiket = '', customer = '', layanan = '', kodePerangkat = '', sto = '', datekMetro = '';

  if (!text.includes('#REQORBIT') || !text.includes('#PINDAHUPLINK')) {
    return { 
      success: false, 
      error: `Format yang benar:
#REQORBIT #PINDAHUPLINK

No tiket/lapsung : ...
customer: ...
layanan : ...
Perangkat Orbit : ...
STO : ...
Datek Metro Eksisting (contoh:ME-D2-CPP 1/2/3:3125) : ...` 
    };
  }

  for (const line of lines) {
    const l = line.trim().toLowerCase();
    if (l.startsWith('no tiket/lapsung :')) noTiket = line.split(':')[1]?.trim() || '';
    else if (l.startsWith('customer:')) customer = line.split(':')[1]?.trim() || '';
    else if (l.startsWith('layanan :')) layanan = line.split(':')[1]?.trim() || '';
    else if (l.startsWith('perangkat orbit :')) kodePerangkat = line.split(':')[1]?.trim() || '';
    else if (l.startsWith('sto :')) sto = line.split(':')[1]?.trim() || '';
    else if (l.startsWith('datek metro eksisting')) datekMetro = line.split(':')[1]?.trim() || '';
  }

  if (!noTiket || !customer || !layanan || !kodePerangkat || !sto || !datekMetro) {
    return { 
      success: false, 
      error: `Format yang benar:
#REQORBIT #PINDAHUPLINK

No tiket/lapsung : ...
customer: ...
layanan : ...
Perangkat Orbit : ...
STO : ...
Datek Metro Eksisting (contoh:ME-D2-CPP 1/2/3:3125) : ...` 
    };
  }
  
  return { success: true, data: { customer, kodePerangkat, noTiket, layanan, witelSto: sto, datekMetro } };
}

export function buildOrderMessage(order: any, statusText: string): string {
  return `Order: ${order.orderNumber}
---------------------------
No tiket/lapsung : ${order.noTiket}
Customer: ${order.customer}
Layanan: ${order.layanan}
Perangkat Orbit: ${order.kodePerangkat}
STO: ${order.witelSto}
Datek Metro Eksisting (contoh:ME-D2-CPP 1/2/3:3125): ${order.datekMetro}
Dibuat oleh: @${order.requesterUsername} (${order.requesterRole})
━━━━━━━━━━━━━━━━━━━━
Status: ${statusText}`;
}

export async function sendOrEditOrderMessage(ctx: any, order: any, status: string, actionBy?: string) {
  let statusText = '';
  let keyboard: any;

  switch (status) {
    case 'pending':
      statusText = 'Menunggu diproses';
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Accept', `accept_${order.id}`), 
         Markup.button.callback('❌ Reject', `reject_${order.id}`)]
      ]);
      break;
    case 'accepted':
      statusText = `Diterima oleh ${actionBy || order.acceptedBy || '-'}`;
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✔ Selesai', `done_${order.id}`), 
         Markup.button.callback('✖ Batal', `cancel_${order.id}`)]
      ]);
      break;
    case 'done':
      statusText = `Selesai oleh ${actionBy || order.completedBy || '-'}`;
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Rollback', `rollback_${order.id}`)]
      ]);
      break;
    case 'rollback':
      statusText = `Di-rollback oleh ${actionBy || order.completedBy || '-'}`;
      keyboard = undefined;
      break;
    default:
      statusText = status;
      keyboard = undefined;
  }

  const messageText = buildOrderMessage(order, statusText);
  
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(messageText, { ...keyboard });
    } catch (error: any) {
      if (!error.message?.includes('message is not modified')) {
        console.error('Error editing message:', error);
      }
    }
  } else {
    await ctx.reply(messageText, keyboard);
  }
}