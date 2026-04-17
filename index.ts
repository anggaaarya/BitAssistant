import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import express from 'express';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN tidak ditemukan');
  process.exit(1);
}

const prisma = new PrismaClient();
const bot = new Telegraf(BOT_TOKEN);

// Health check server untuk UptimeRobot (keep alive)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`Health check server running on port ${PORT}`));

// ==================== Helper Functions ====================
const registrationSession = new Map<number, any>();

function isPrivateChat(ctx: any): boolean {
  return ctx.chat?.type === 'private';
}

function isGroupChat(ctx: any): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

function getChatId(ctx: any): bigint {
  return BigInt(ctx.chat?.id || 0);
}

async function getUserRole(telegramId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  return user?.role || null;
}

async function isUserRegistered(telegramId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  return user?.isRegistered || false;
}

async function isAdminOrSO(telegramId: number): Promise<boolean> {
  const role = await getUserRole(telegramId);
  return role === 'ADMIN' || role === 'SOAREA';
}

async function isAdmin(telegramId: number): Promise<boolean> {
  const role = await getUserRole(telegramId);
  return role === 'ADMIN';
}

async function generateOrderNumber(chatId: bigint): Promise<string> {
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

// ==================== Parsing & Validation ====================
function parseRequestMessage(text: string): { 
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

function buildOrderMessage(order: any, statusText: string): string {
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

async function sendOrEditOrderMessage(ctx: any, order: any, status: string, actionBy?: string) {
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

// ==================== Registration Flow ====================
async function startRegistration(ctx: any) {
  if (!isPrivateChat(ctx)) return;
  registrationSession.set(ctx.from.id, { step: 1, data: {} });
  await ctx.reply('📝 Registrasi\nMasukkan Nama lengkap Anda:');
}

async function completeRegistration(ctx: any, telegramId: number, data: any) {
  await prisma.user.upsert({
    where: { telegramId },
    update: {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      namaLengkap: data.nama,
      nik: data.nik,
      noHp: data.noHp,
      perusahaan: data.perusahaan,
      loker: data.loker,
      atasanTif: data.atasanTif,
      isRegistered: true
    },
    create: {
      telegramId,
      username: ctx.from.username || 'unknown',
      firstName: ctx.from.first_name || '',
      namaLengkap: data.nama,
      nik: data.nik,
      noHp: data.noHp,
      perusahaan: data.perusahaan,
      loker: data.loker,
      atasanTif: data.atasanTif,
      role: '',
      isRegistered: true
    }
  });
  registrationSession.delete(telegramId);
  await showRoleSelection(ctx);
}

async function showRoleSelection(ctx: any) {
  if (!isPrivateChat(ctx)) return;
  await ctx.reply('✅ Registrasi berhasil!\nPilih role Anda:', Markup.inlineKeyboard([
    [Markup.button.callback('📋 TIF District', 'role_TIF')],
    [Markup.button.callback('🔧 TA', 'role_TA')],
    [Markup.button.callback('⭐ SO Area (Hubungi Admin)', 'role_SOAREA')]
  ]));
}

// ==================== Admin Menus ====================
async function showAdminMenu(ctx: any) {
  await ctx.reply('Menu Admin', Markup.inlineKeyboard([
    [Markup.button.callback('📋 Kelola User', 'admin_kelola_user')],
    [Markup.button.callback('📊 Status Orbit', 'admin_status_orbit')],
    [Markup.button.callback('❌ Tutup Menu', 'admin_close_menu')]
  ]));
}

async function showUserManagementMenu(ctx: any) {
  await ctx.reply('Kelola User', Markup.inlineKeyboard([
    [Markup.button.callback('👥 Lihat User', 'admin_lihat_user')],
    [Markup.button.callback('🔄 Reset User', 'admin_reset_user')],
    [Markup.button.callback('🗑️ Hapus User', 'admin_hapus_user')],
    [Markup.button.callback('✏️ Edit User', 'admin_edit_user')],
    [Markup.button.callback('🔙 Kembali', 'admin_back_to_menu')]
  ]));
}

async function showStatusOrbit(ctx: any) {
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

async function showStatusCommand(ctx: any) {
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

async function showRollbackMenu(ctx: any) {
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

async function showAllUsers(ctx: any) {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  if (users.length === 0) {
    await ctx.reply('Belum ada user.');
    return;
  }
  let msg = `Daftar User (${users.length})\n\n`;
  for (const user of users) {
    msg += `ID: ${user.telegramId}\n`;
    msg += `Username: @${user.username}\n`;
    msg += `Nama: ${user.namaLengkap || '-'}\n`;
    msg += `Role: ${user.role || '-'}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  }
  await ctx.reply(msg);
}

async function resetUserRole(ctx: any, targetId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User ID ${targetId} tidak ditemukan.`);
    return;
  }
  await prisma.user.update({ where: { telegramId: targetId }, data: { role: '' } });
  await ctx.reply(`Role user @${user.username} telah di-reset.`);
}

async function deleteUser(ctx: any, targetId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User ID ${targetId} tidak ditemukan.`);
    return;
  }
  await prisma.user.delete({ where: { telegramId: targetId } });
  await ctx.reply(`User @${user.username} telah dihapus.`);
}

async function editUserRole(ctx: any, targetId: number, newRole: string) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User ID ${targetId} tidak ditemukan.`);
    return;
  }
  await prisma.user.update({ where: { telegramId: targetId }, data: { role: newRole } });
  await ctx.reply(`Role user @${user.username} diubah menjadi ${newRole}.`);
}

const adminSession = new Map<number, any>();

// ==================== Actions ====================
bot.action('role_TIF', async (ctx) => {
  await prisma.user.update({ where: { telegramId: ctx.from.id }, data: { role: 'TIF' } });
  await ctx.answerCbQuery('✅ Role TIF District dipilih');
  await ctx.reply('Anda terdaftar sebagai TIF District.');
});

bot.action('role_TA', async (ctx) => {
  await prisma.user.update({ where: { telegramId: ctx.from.id }, data: { role: 'TA' } });
  await ctx.answerCbQuery('✅ Role TA dipilih');
  await ctx.reply('Anda terdaftar sebagai TA.');
});

bot.action('role_SOAREA', async (ctx) => {
  await ctx.answerCbQuery('Hubungi Admin');
  await ctx.reply('Role SO Area hanya bisa ditambahkan oleh admin. Hubungi @mmdafiq.');
});

bot.action('admin_kelola_user', async (ctx) => {
  if (await isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery();
    await showUserManagementMenu(ctx);
  }
});

bot.action('admin_status_orbit', async (ctx) => {
  if (await isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery();
    await showStatusOrbit(ctx);
    await showAdminMenu(ctx);
  }
});

bot.action('admin_back_to_menu', async (ctx) => {
  if (await isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery();
    await showAdminMenu(ctx);
  }
});

bot.action('admin_close_menu', async (ctx) => {
  await ctx.answerCbQuery('Menu ditutup');
  await ctx.deleteMessage();
});

bot.action('admin_lihat_user', async (ctx) => {
  if (await isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery();
    await showAllUsers(ctx);
    await showUserManagementMenu(ctx);
  }
});

bot.action('admin_reset_user', async (ctx) => {
  if (await isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery();
    adminSession.set(ctx.from.id, { action: 'reset_user' });
    await ctx.reply('Masukkan ID Telegram user:');
  }
});

bot.action('admin_hapus_user', async (ctx) => {
  if (await isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery();
    adminSession.set(ctx.from.id, { action: 'delete_user' });
    await ctx.reply('Masukkan ID Telegram user:');
  }
});

bot.action('admin_edit_user', async (ctx) => {
  if (await isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery();
    adminSession.set(ctx.from.id, { action: 'edit_user' });
    await ctx.reply('Masukkan ID Telegram user:');
  }
});

// Handler untuk pilihan Loker
bot.action(/loker_(.+)/, async (ctx) => {
  await ctx.answerCbQuery('Memproses...');
  
  const telegramId = ctx.from.id;
  const selectedLoker = ctx.match[1];
  const session = registrationSession.get(telegramId);
  
  if (session && session.step === 5) {
    session.data.loker = selectedLoker;
    session.step = 6;
    await ctx.reply(`Masukkan Atasan TIF (Nama atau NIK):`);
  } else {
    await ctx.reply('Session tidak valid, silakan /start ulang');
  }
});

// Rollback select action
bot.action(/rollback_select_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
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
    data: { status: 'pending', acceptedBy: null, acceptedAt: null, completedBy: null, completedAt: null }
  });
  const msg = buildOrderMessage(order, 'Selesai - Siap di-rollback');
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✔ Selesai', `rollback_complete_${order.id}`),
     Markup.button.callback('✖ Batal', `rollback_cancel_${order.id}`)]
  ]);
  await ctx.reply(msg, keyboard);
});

// Rollback complete action
bot.action(/rollback_complete_(\d+)/, async (ctx) => {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const orderId = parseInt(ctx.match[1]);
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
    data: { status: 'done', completedBy: ctx.from.username, completedAt: new Date() }
  });
  await ctx.answerCbQuery(`Rollback selesai`);
  await ctx.editMessageText(`✅ Rollback selesai. Orbit ${updatedOrder.kodePerangkat} telah aktif kembali.`);
});

// Rollback cancel action
bot.action(/rollback_cancel_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
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
  await ctx.editMessageText(`❌ Rollback dibatalkan.`);
});

// Rollback action (from message button)
bot.action(/rollback_(\d+)/, async (ctx) => {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const orderId = parseInt(ctx.match[1]);
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
    data: { status: 'done', completedBy: ctx.from.username, completedAt: new Date() }
  });
  await ctx.answerCbQuery('Order di-rollback');
  await sendOrEditOrderMessage(ctx, updatedOrder, 'done', ctx.from.username);
});

// Accept action
bot.action(/accept_(\d+)/, async (ctx) => {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const orderId = parseInt(ctx.match[1]);
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
    data: { status: 'accepted', acceptedBy: ctx.from.username, acceptedAt: new Date() }
  });
  await ctx.answerCbQuery('Order diterima');
  await sendOrEditOrderMessage(ctx, updatedOrder, 'accepted', ctx.from.username);
});

// Reject action
bot.action(/reject_(\d+)/, async (ctx) => {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const orderId = parseInt(ctx.match[1]);
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
  
  const updatedOrder = await prisma.order.update({ where: { id: orderId }, data: { status: 'rejected' } });
  await ctx.answerCbQuery('Order ditolak');
  await ctx.reply(`Order ${updatedOrder.orderNumber} - DITOLAK`);
});

// Done action
bot.action(/done_(\d+)/, async (ctx) => {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const orderId = parseInt(ctx.match[1]);
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
    data: { status: 'done', completedBy: ctx.from.username, completedAt: new Date() }
  });
  await ctx.answerCbQuery('Order selesai');
  await sendOrEditOrderMessage(ctx, updatedOrder, 'done', ctx.from.username);
});

// Cancel action
bot.action(/cancel_(\d+)/, async (ctx) => {
  if (!await isAdminOrSO(ctx.from.id)) {
    await ctx.answerCbQuery('Tidak punya akses');
    return;
  }
  const orderId = parseInt(ctx.match[1]);
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
  
  const updatedOrder = await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
  await ctx.answerCbQuery('Order dibatalkan');
  await ctx.reply(`Order ${updatedOrder.orderNumber} - DIBATALKAN`);
});

// ==================== Commands ====================
bot.command('start', async (ctx) => {
  if (isGroupChat(ctx)) {
    await ctx.reply('Registrasi hanya di private chat. Kirim /start ke DM saya.');
    return;
  }
  const isReg = await isUserRegistered(ctx.from.id);
  const role = await getUserRole(ctx.from.id);
  if (isReg && role === 'ADMIN') {
    await showAdminMenu(ctx);
    return;
  }
  if (isReg && role) {
    await ctx.reply(`Bit Assistant aktif! Role Anda: ${role}`);
    return;
  }
  if (isReg && !role) {
    await showRoleSelection(ctx);
    return;
  }
  await startRegistration(ctx);
});

bot.command('adduser', async (ctx) => {
  if (!await isAdmin(ctx.from.id)) {
    await ctx.reply('Hanya admin.');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 4) {
    await ctx.reply('Format: /adduser <telegramId> <username> <role>');
    return;
  }
  const telegramId = parseInt(args[1]);
  const username = args[2];
  const role = args[3].toUpperCase();
  if (!['ADMIN', 'SOAREA', 'TIF', 'TA'].includes(role)) {
    await ctx.reply('Role tidak valid.');
    return;
  }
  await prisma.user.upsert({
    where: { telegramId },
    update: { username, role, isRegistered: true },
    create: { telegramId, username, role, firstName: '', isRegistered: true }
  });
  await ctx.reply(`User ${username} (ID: ${telegramId}) dengan role ${role} berhasil ditambahkan.`);
});

bot.command('status', async (ctx) => {
  if (!isGroupChat(ctx)) return;
  const userRole = await getUserRole(ctx.from.id);
  if (!userRole) return;
  await showStatusCommand(ctx);
});

bot.command('rollback', async (ctx) => {
  if (!isGroupChat(ctx)) return;
  const userRole = await getUserRole(ctx.from.id);
  if (!userRole) return;
  await showRollbackMenu(ctx);
});

// ==================== Text Handler ====================
bot.on('text', async (ctx) => {
  const pesan = ctx.message.text;
  const telegramId = ctx.from.id;
  const chatId = getChatId(ctx);

  const adminAction = adminSession.get(telegramId);
  if (adminAction && isPrivateChat(ctx)) {
    const targetId = parseInt(pesan);
    if (isNaN(targetId)) {
      await ctx.reply('ID harus angka.');
      return;
    }
    if (adminAction.action === 'reset_user') {
      await resetUserRole(ctx, targetId);
    } else if (adminAction.action === 'delete_user') {
      await deleteUser(ctx, targetId);
    } else if (adminAction.action === 'edit_user') {
      adminSession.set(telegramId, { action: 'edit_user_role', targetId });
      await ctx.reply('Masukkan role baru (ADMIN, SOAREA, TIF, TA):');
      return;
    }
    adminSession.delete(telegramId);
    await showUserManagementMenu(ctx);
    return;
  }
  
  const editAction = adminSession.get(telegramId);
  if (editAction && editAction.action === 'edit_user_role' && isPrivateChat(ctx)) {
    const newRole = pesan.toUpperCase();
    if (!['ADMIN', 'SOAREA', 'TIF', 'TA'].includes(newRole)) {
      await ctx.reply('Role tidak valid.');
      return;
    }
    await editUserRole(ctx, editAction.targetId, newRole);
    adminSession.delete(telegramId);
    await showUserManagementMenu(ctx);
    return;
  }

  const session = registrationSession.get(telegramId);
  if (session && isPrivateChat(ctx)) {
    switch (session.step) {
      case 1:
        session.data.nama = pesan;
        session.step = 2;
        await ctx.reply('Masukkan NIK:');
        break;
      case 2:
        session.data.nik = pesan;
        session.step = 3;
        await ctx.reply('Masukkan No HP:');
        break;
      case 3:
        session.data.noHp = pesan;
        session.step = 4;
        await ctx.reply('Masukkan Perusahaan:');
        break;
      case 4:
        session.data.perusahaan = pesan;
        session.step = 5;
        await ctx.reply('Pilih District/Loker:', Markup.inlineKeyboard([
          [Markup.button.callback('ROC-2', 'loker_ROC-2')],
          [Markup.button.callback('JAKUT', 'loker_JAKUT'), Markup.button.callback('JAKPUS', 'loker_JAKPUS'), Markup.button.callback('JAKTIM', 'loker_JAKTIM')],
          [Markup.button.callback('JAKBAR', 'loker_JAKBAR'), Markup.button.callback('JAKSEL', 'loker_JAKSEL')],
          [Markup.button.callback('BEKASI', 'loker_BEKASI'), Markup.button.callback('BANTEN', 'loker_BANTEN'), Markup.button.callback('BOGOR', 'loker_BOGOR')],
          [Markup.button.callback('TANGERANG', 'loker_TANGERANG'), Markup.button.callback('EOS/DA', 'loker_EOS/DA')]
        ]));
        break;
      case 6:
        session.data.atasanTif = pesan;
        await completeRegistration(ctx, telegramId, session.data);
        break;
    }
    return;
  }

  if (isGroupChat(ctx)) {
    const userRole = await getUserRole(telegramId);
    if (!userRole) return;
    
    if (pesan.includes('#REQORBIT') && pesan.includes('#PINDAHUPLINK')) {
      const parsed = parseRequestMessage(pesan);
      if (!parsed.success) {
        await ctx.reply(parsed.error || 'Format salah');
        return;
      }
      if (!parsed.data) {
        await ctx.reply('Terjadi kesalahan parsing data');
        return;
      }
      const { customer, kodePerangkat, noTiket, layanan, witelSto, datekMetro } = parsed.data;
      const orderNumber = await generateOrderNumber(chatId);
      const order = await prisma.order.create({
        data: {
          orderNumber,
          chatId,
          customer,
          kodePerangkat,
          noTiket,
          layanan,
          witelSto,
          datekMetro,
          requesterNik: telegramId.toString(),
          requesterUsername: ctx.from.username || 'unknown',
          requesterRole: userRole,
          status: 'pending'
        }
      });
      await sendOrEditOrderMessage(ctx, order, 'pending');
      await ctx.reply(`✅ Request tersimpan dengan nomor order: ${order.orderNumber}`);
    }
  }
});

// ==================== Health Check Server (untuk UptimeRobot) ====================
// (sudah di atas)

// ==================== Launch ====================
if (process.env.NODE_ENV !== 'production') {
  bot.launch().then(() => console.log('Bot running locally...'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default async (req: any, res: any) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body, res);
      res.status(200).end();
    } catch (error) {
      console.error(error);
      res.status(500).end();
    }
  } else {
    res.status(200).send('Bit Assistant Bot is running!');
  }
};