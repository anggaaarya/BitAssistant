import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN tidak ditemukan di .env');
  process.exit(1);
}

const prisma = new PrismaClient();
const bot = new Telegraf(BOT_TOKEN);

// Session untuk menyimpan state registrasi
const registrationSession = new Map<number, any>();

function isPrivateChat(ctx: any): boolean {
  const chat = ctx.chat;
  return chat && chat.type === 'private';
}

function isGroupChat(ctx: any): boolean {
  const chat = ctx.chat;
  return chat && (chat.type === 'group' || chat.type === 'supergroup');
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

async function generateOrderNumber(): Promise<string> {
  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, '0')}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear()}`;
  
  const ordersToday = await prisma.order.findMany({
    where: { orderNumber: { startsWith: `OB-${dateStr}-` } },
    orderBy: { orderNumber: 'desc' }
  });
  
  let nextNumber = 1;
  if (ordersToday.length > 0) {
    const lastNum = parseInt(ordersToday[0].orderNumber.split('-')[2] || '0');
    nextNumber = lastNum + 1;
  }
  
  let orderNumber = `OB-${dateStr}-${nextNumber.toString().padStart(3, '0')}`;
  let exists = await prisma.order.findUnique({ where: { orderNumber } });
  
  while (exists) {
    nextNumber++;
    orderNumber = `OB-${dateStr}-${nextNumber.toString().padStart(3, '0')}`;
    exists = await prisma.order.findUnique({ where: { orderNumber } });
  }
  
  return orderNumber;
}

function parseRequestMessage(text: string) {
  const lines = text.split('\n');
  let customer = '', kodePerangkat = '', noTiket = '', layanan = '', witelSto = '', datekMetro = '';
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('customer')) {
      customer = line.split(':')[1]?.trim() || '';
    } else if (lowerLine.includes('kode perangkat')) {
      kodePerangkat = line.split(':')[1]?.trim() || '';
    } else if (lowerLine.includes('no tiket')) {
      noTiket = line.split(':')[1]?.trim() || '';
    } else if (lowerLine.includes('layanan')) {
      layanan = line.split(':')[1]?.trim() || '';
    } else if (lowerLine.includes('witels') || lowerLine.includes('witel') || lowerLine.includes('witels/sto')) {
      witelSto = line.split(':')[1]?.trim() || '';
    } else if (lowerLine.includes('datek')) {
      datekMetro = line.split(':')[1]?.trim() || '';
    }
  }
  
  return { customer, kodePerangkat, noTiket, layanan, witelSto, datekMetro };
}

function buildOrderMessage(order: any, statusText: string): string {
  return `Order: ${order.orderNumber}
---------------------------
Customer: ${order.customer}
Perangkat: ${order.kodePerangkat}
Tiket: ${order.noTiket}
Layanan: ${order.layanan}
WITEL/STO: ${order.witelSto}
Datek Metro: ${order.datekMetro}
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
        [Markup.button.callback('✅ Accept', `accept_${order.id}`), Markup.button.callback('❌ Reject', `reject_${order.id}`)]
      ]);
      break;
    case 'accepted':
      statusText = `Diterima oleh ${actionBy || order.acceptedBy || '-'}`;
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✔ Selesai', `done_${order.id}`), Markup.button.callback('✖ Batal', `cancel_${order.id}`)]
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
    await ctx.editMessageText(messageText, { ...keyboard });
  } else {
    await ctx.reply(messageText, keyboard);
  }
}

async function startRegistration(ctx: any) {
  if (!isPrivateChat(ctx)) return;
  const telegramId = ctx.from.id;
  registrationSession.set(telegramId, { step: 1, data: {} });
  await ctx.reply('Silakan registrasi terlebih dahulu\n\nMasukkan Nama lengkap Anda:');
}

async function completeRegistration(ctx: any, telegramId: number, data: any) {
  const username = ctx.from.username || 'unknown';
  const firstName = ctx.from.first_name || '';
  
  await prisma.user.upsert({
    where: { telegramId },
    update: {
      username,
      firstName,
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
      username,
      firstName,
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
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📋 TIF District', 'role_TIF')],
    [Markup.button.callback('🔧 TA', 'role_TA')],
    [Markup.button.callback('⭐ SO Area (Hubungi Admin)', 'role_SOAREA')]
  ]);
  await ctx.reply(
    `Registrasi berhasil!\n\n` +
    `Silakan pilih role Anda:\n\n` +
    `TIF District - Dapat membuat request\n` +
    `TA - Dapat membuat request\n` +
    `SO Area - Dapat memproses request (harus di-approve admin)\n\n` +
    `Pilih role di bawah ini:`,
    keyboard
  );
}

async function showAdminMenu(ctx: any) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📋 Kelola User', 'admin_kelola_user')],
    [Markup.button.callback('📊 Status Orbit', 'admin_status_orbit')],
    [Markup.button.callback('❌ Tutup Menu', 'admin_close_menu')]
  ]);
  await ctx.reply(`Menu Admin\n\nSilakan pilih menu di bawah ini:`, keyboard);
}

async function showUserManagementMenu(ctx: any) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('👥 Lihat User', 'admin_lihat_user')],
    [Markup.button.callback('🔄 Reset User', 'admin_reset_user')],
    [Markup.button.callback('🗑️ Hapus User', 'admin_hapus_user')],
    [Markup.button.callback('✏️ Edit User', 'admin_edit_user')],
    [Markup.button.callback('🔙 Kembali ke Menu Utama', 'admin_back_to_menu')]
  ]);
  await ctx.reply(`Kelola User\n\nPilih aksi yang ingin dilakukan:`, keyboard);
}

async function showStatusOrbit(ctx: any) {
  const activeOrbits = await prisma.order.findMany({
    where: {
      status: 'done'
    },
    orderBy: { createdAt: 'desc' }
  });
  
  if (activeOrbits.length === 0) {
    await ctx.reply('Status Orbit\n\nTidak ada orbit yang aktif.');
    return;
  }
  
  let message = `Status Orbit (Aktif: ${activeOrbits.length})\n\n`;
  for (const order of activeOrbits) {
    message += `🟢 ${order.kodePerangkat}\n`;
  }
  
  await ctx.reply(message);
}

async function showStatusCommand(ctx: any) {
  const activeOrbits = await prisma.order.findMany({
    where: {
      status: 'done'
    },
    orderBy: { createdAt: 'desc' }
  });
  
  if (activeOrbits.length === 0) {
    await ctx.reply('Status Orbit\n\nTidak ada orbit yang aktif.');
    return;
  }
  
  let message = `Status Orbit (Aktif: ${activeOrbits.length})\n\n`;
  for (const order of activeOrbits) {
    message += `🟢 ${order.kodePerangkat}\n`;
  }
  
  await ctx.reply(message);
}

async function showRollbackMenu(ctx: any) {
  const activeOrbits = await prisma.order.findMany({
    where: {
      status: 'done'
    },
    orderBy: { createdAt: 'desc' }
  });
  
  if (activeOrbits.length === 0) {
    await ctx.reply('Tidak ada orbit yang aktif untuk di-rollback.');
    return;
  }
  
  const buttons = [];
  for (const order of activeOrbits) {
    buttons.push(Markup.button.callback(order.kodePerangkat, `rollback_select_${order.id}`));
  }
  
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  
  const keyboard = Markup.inlineKeyboard(rows);
  await ctx.reply('Pilih orbit yang ingin di-rollback:', keyboard);
}

async function showAllUsers(ctx: any) {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' }
  });
  
  if (users.length === 0) {
    await ctx.reply('Belum ada user yang terdaftar.');
    return;
  }
  
  let message = `Daftar User (${users.length})\n\n`;
  for (const user of users) {
    message += `ID: ${user.telegramId}\n`;
    message += `Username: @${user.username}\n`;
    message += `Nama: ${user.namaLengkap || '-'}\n`;
    message += `Role: ${user.role || 'Belum pilih role'}\n`;
    message += `Registrasi: ${user.isRegistered ? 'Ya' : 'Belum'}\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
  }
  
  await ctx.reply(message);
}

async function resetUserRole(ctx: any, targetId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User dengan ID ${targetId} tidak ditemukan.`);
    return;
  }
  
  await prisma.user.update({
    where: { telegramId: targetId },
    data: { role: '' }
  });
  await ctx.reply(`Role user @${user.username} (ID: ${targetId}) telah di-reset. User harus memilih role ulang dengan /start.`);
}

async function deleteUser(ctx: any, targetId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User dengan ID ${targetId} tidak ditemukan.`);
    return;
  }
  
  await prisma.user.delete({ where: { telegramId: targetId } });
  await ctx.reply(`User @${user.username} (ID: ${targetId}) telah dihapus dari database.`);
}

async function editUserRole(ctx: any, targetId: number, newRole: string) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User dengan ID ${targetId} tidak ditemukan.`);
    return;
  }
  
  await prisma.user.update({
    where: { telegramId: targetId },
    data: { role: newRole }
  });
  await ctx.reply(`Role user @${user.username} (ID: ${targetId}) telah diubah menjadi ${newRole}.`);
}

const adminSession = new Map<number, any>();

// ==================== CALLBACKS ====================

bot.action('role_TIF', async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || 'unknown';
  const firstName = ctx.from.first_name || '';
  
  await prisma.user.update({
    where: { telegramId },
    data: { username, firstName, role: 'TIF' }
  });
  
  try { await ctx.answerCbQuery('Role TIF District dipilih'); } catch (e) {}
  await ctx.reply(`Anda telah terdaftar sebagai TIF District.\n\nSekarang Anda bisa membuat request di GRUP.`);
});

bot.action('role_TA', async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || 'unknown';
  const firstName = ctx.from.first_name || '';
  
  await prisma.user.update({
    where: { telegramId },
    data: { username, firstName, role: 'TA' }
  });
  
  try { await ctx.answerCbQuery('Role TA dipilih'); } catch (e) {}
  await ctx.reply(`Anda telah terdaftar sebagai TA.\n\nSekarang Anda bisa membuat request di GRUP.`);
});

bot.action('role_SOAREA', async (ctx) => {
  try { await ctx.answerCbQuery('Hubungi Admin'); } catch (e) {}
  await ctx.reply(
    `Role SO Area\n\n` +
    `Untuk mendapatkan role SO Area, silakan hubungi:\n` +
    `Admin M Afiq\n` +
    `Telegram: @mmdafiq`
  );
});

bot.action(/loker_(.+)/, async (ctx) => {
  const telegramId = ctx.from.id;
  const selectedLoker = ctx.match[1];
  const session = registrationSession.get(telegramId);
  
  if (session && session.step === 5) {
    session.data.loker = selectedLoker;
    session.step = 6;
    try { await ctx.answerCbQuery(`Loker: ${selectedLoker}`); } catch (e) {}
    await ctx.reply(`Masukkan Atasan TIF (Nama atau NIK):`);
  } else {
    try { await ctx.answerCbQuery('Session tidak valid, silakan /start ulang'); } catch (e) {}
  }
});

bot.action('admin_kelola_user', async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin yang bisa mengakses menu ini.'); } catch (e) {}
    return;
  }
  try { await ctx.answerCbQuery(); } catch (e) {}
  await showUserManagementMenu(ctx);
});

bot.action('admin_status_orbit', async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin yang bisa mengakses menu ini.'); } catch (e) {}
    return;
  }
  try { await ctx.answerCbQuery(); } catch (e) {}
  await showStatusOrbit(ctx);
  await showAdminMenu(ctx);
});

bot.action('admin_back_to_menu', async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin yang bisa mengakses menu ini.'); } catch (e) {}
    return;
  }
  try { await ctx.answerCbQuery(); } catch (e) {}
  await showAdminMenu(ctx);
});

bot.action('admin_close_menu', async (ctx) => {
  try { await ctx.answerCbQuery('Menu ditutup'); } catch (e) {}
  await ctx.deleteMessage();
});

bot.action('admin_lihat_user', async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin yang bisa mengakses menu ini.'); } catch (e) {}
    return;
  }
  try { await ctx.answerCbQuery(); } catch (e) {}
  await showAllUsers(ctx);
  await showUserManagementMenu(ctx);
});

bot.action('admin_reset_user', async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin yang bisa mengakses menu ini.'); } catch (e) {}
    return;
  }
  try { await ctx.answerCbQuery(); } catch (e) {}
  adminSession.set(ctx.from.id, { action: 'reset_user' });
  await ctx.reply('Masukkan ID Telegram user yang ingin di-reset role-nya:');
});

bot.action('admin_hapus_user', async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin yang bisa mengakses menu ini.'); } catch (e) {}
    return;
  }
  try { await ctx.answerCbQuery(); } catch (e) {}
  adminSession.set(ctx.from.id, { action: 'delete_user' });
  await ctx.reply('Masukkan ID Telegram user yang ingin dihapus:');
});

bot.action('admin_edit_user', async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin yang bisa mengakses menu ini.'); } catch (e) {}
    return;
  }
  try { await ctx.answerCbQuery(); } catch (e) {}
  adminSession.set(ctx.from.id, { action: 'edit_user', step: 1 });
  await ctx.reply('Masukkan ID Telegram user yang ingin diubah role-nya:');
});

// Callback untuk /rollback - pilih orbit (TAHAP 2: orbit langsung hilang dari Status Orbit)
bot.action(/rollback_select_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  
  if (!order) {
    try { await ctx.answerCbQuery('Order tidak ditemukan'); } catch (e) {}
    return;
  }
  
  try { await ctx.answerCbQuery(`Orbit ${order.kodePerangkat} dipilih`); } catch (e) {}
  
  // TAHAP 2: Ubah status menjadi 'pending' sementara (orbit hilang dari Status Orbit)
  await prisma.order.update({
    where: { id: orderId },
    data: { 
      status: 'pending', 
      acceptedBy: null, 
      acceptedAt: null, 
      completedBy: null,
      completedAt: null
    }
  });
  
  const messageText = buildOrderMessage(order, 'Selesai - Siap di-rollback');
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✔ Selesai', `rollback_complete_${order.id}`), Markup.button.callback('✖ Batal', `rollback_cancel_${order.id}`)]
  ]);
  
  await ctx.reply(messageText, keyboard);
});

// Callback untuk menyelesaikan rollback (TAHAP 3: orbit aktif kembali)
bot.action(/rollback_complete_(\d+)/, async (ctx) => {
  const userId = ctx.from.id;
  if (!(await isAdminOrSO(userId))) {
    try { await ctx.answerCbQuery('⛔ Hanya Admin atau SO AREA yang bisa melakukan rollback.'); } catch (e) {}
    return;
  }
  
  const orderId = parseInt(ctx.match[1]);
  
  // TAHAP 3: Ubah status menjadi 'done' (orbit aktif kembali)
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { 
      status: 'done', 
      completedBy: ctx.from.username || 'unknown', 
      completedAt: new Date()
    }
  });
  
  console.log(`Rollback complete: Order ${order.orderNumber} (${order.kodePerangkat}) status menjadi ${order.status}`);
  
  try { await ctx.answerCbQuery(`Rollback selesai, orbit ${order.kodePerangkat} aktif kembali`); } catch (e) {}
  await ctx.editMessageText(`✅ Rollback selesai. Orbit ${order.kodePerangkat} telah aktif kembali.`);
});

// Callback untuk batal rollback
bot.action(/rollback_cancel_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  
  // Batalkan rollback: kembalikan status ke 'done'
  await prisma.order.update({
    where: { id: orderId },
    data: { status: 'done' }
  });
  
  try { await ctx.answerCbQuery(`Rollback dibatalkan`); } catch (e) {}
  await ctx.editMessageText(`❌ Rollback untuk orbit ${order?.kodePerangkat} dibatalkan.`);
});

// Callback untuk tombol rollback di pesan order (langsung rollback)
bot.action(/rollback_(\d+)/, async (ctx) => {
  const userId = ctx.from.id;
  if (!(await isAdminOrSO(userId))) {
    try { await ctx.answerCbQuery('⛔ Hanya Admin atau SO AREA yang bisa melakukan rollback.'); } catch (e) {}
    return;
  }
  const orderId = parseInt(ctx.match[1]);
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { 
      status: 'done', 
      completedBy: ctx.from.username || 'unknown', 
      completedAt: new Date()
    }
  });
  try { await ctx.answerCbQuery('Order di-rollback'); } catch (e) {}
  await sendOrEditOrderMessage(ctx, order, 'done', ctx.from.username);
  await ctx.reply(`Order ${order.orderNumber} telah di-rollback.`);
});

bot.action(/accept_(\d+)/, async (ctx) => {
  const userId = ctx.from.id;
  if (!(await isAdminOrSO(userId))) {
    try { await ctx.answerCbQuery('Hanya Admin atau SO AREA yang bisa accept.'); } catch (e) {}
    return;
  }
  const orderId = parseInt(ctx.match[1]);
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'accepted', acceptedBy: ctx.from.username || 'unknown', acceptedAt: new Date() }
  });
  try { await ctx.answerCbQuery('Order diterima'); } catch (e) {}
  await sendOrEditOrderMessage(ctx, order, 'accepted', ctx.from.username);
});

bot.action(/reject_(\d+)/, async (ctx) => {
  if (!(await isAdminOrSO(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin atau SO AREA yang bisa reject.'); } catch (e) {}
    return;
  }
  const orderId = parseInt(ctx.match[1]);
  const order = await prisma.order.update({ where: { id: orderId }, data: { status: 'rejected' } });
  try { await ctx.answerCbQuery('Order ditolak'); } catch (e) {}
  await ctx.reply(`Order ${order.orderNumber} - DITOLAK`);
});

bot.action(/done_(\d+)/, async (ctx) => {
  if (!(await isAdminOrSO(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin atau SO AREA yang bisa menyelesaikan.'); } catch (e) {}
    return;
  }
  const orderId = parseInt(ctx.match[1]);
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'done', completedBy: ctx.from.username || 'unknown', completedAt: new Date() }
  });
  try { await ctx.answerCbQuery('Order selesai'); } catch (e) {}
  await sendOrEditOrderMessage(ctx, order, 'done', ctx.from.username);
});

bot.action(/cancel_(\d+)/, async (ctx) => {
  if (!(await isAdminOrSO(ctx.from.id))) {
    try { await ctx.answerCbQuery('Hanya Admin atau SO AREA yang bisa membatalkan.'); } catch (e) {}
    return;
  }
  const orderId = parseInt(ctx.match[1]);
  const order = await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
  try { await ctx.answerCbQuery('Order dibatalkan'); } catch (e) {}
  await ctx.reply(`Order ${order.orderNumber} - DIBATALKAN`);
});

// ==================== COMMANDS ====================

bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;
  const isRegistered = await isUserRegistered(telegramId);
  const role = await getUserRole(telegramId);
  
  if (isGroupChat(ctx)) {
    await ctx.reply('Registrasi tidak bisa dilakukan di grup!\n\nSilakan chat bot ini secara PRIVATE (DM) dan kirim /start untuk registrasi.');
    return;
  }
  
  if (isRegistered && role === 'ADMIN') {
    await showAdminMenu(ctx);
    return;
  }
  
  if (isRegistered && role) {
    await ctx.reply(`Bit Assistant aktif!\nRole Anda: ${role}\n\nCatatan: Request hanya bisa dibuat di GRUP.\n\nKirim pesan dengan #REQORBIT #PINDAHUPLINK`);
    return;
  }
  
  if (isRegistered && !role) {
    await showRoleSelection(ctx);
    return;
  }
  
  await startRegistration(ctx);
});

bot.command('adduser', async (ctx) => {
  const callerRole = await getUserRole(ctx.from.id);
  if (callerRole !== 'ADMIN') {
    await ctx.reply('Hanya admin yang bisa menambahkan user.');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 4) {
    await ctx.reply('Format: /adduser <telegramId> <username> <role>\nRole: ADMIN, SOAREA, TIF, TA');
    return;
  }
  const telegramId = parseInt(args[1]);
  const username = args[2];
  const role = args[3].toUpperCase();
  if (!['ADMIN', 'SOAREA', 'TIF', 'TA'].includes(role)) {
    await ctx.reply('Role tidak valid. Gunakan: ADMIN, SOAREA, TIF, TA');
    return;
  }
  if (isNaN(telegramId)) {
    await ctx.reply('telegramId harus berupa angka.');
    return;
  }
  await prisma.user.upsert({
    where: { telegramId },
    update: { username, role, isRegistered: true },
    create: { telegramId, username, role, firstName: '', isRegistered: true }
  });
  await ctx.reply(`User ${username} (ID: ${telegramId}) dengan role ${role} berhasil ditambahkan/diupdate.`);
});

bot.command('status', async (ctx) => {
  if (!isGroupChat(ctx)) {
    return;
  }
  
  const userRole = await getUserRole(ctx.from.id);
  const isRegistered = await isUserRegistered(ctx.from.id);
  
  if (!isRegistered || !userRole) {
    return;
  }
  
  await showStatusCommand(ctx);
});

bot.command('rollback', async (ctx) => {
  if (!isGroupChat(ctx)) {
    return;
  }
  
  const userRole = await getUserRole(ctx.from.id);
  const isRegistered = await isUserRegistered(ctx.from.id);
  
  if (!isRegistered || !userRole) {
    return;
  }
  
  await showRollbackMenu(ctx);
});

// ==================== HANDLER PESAN TEKS ====================

bot.on('text', async (ctx) => {
  const pesan = ctx.message.text;
  const telegramId = ctx.from.id;
  
  const adminAction = adminSession.get(telegramId);
  if (adminAction && isPrivateChat(ctx)) {
    const targetId = parseInt(pesan);
    if (isNaN(targetId)) {
      await ctx.reply('ID harus berupa angka. Silakan coba lagi.');
      adminSession.delete(telegramId);
      await showUserManagementMenu(ctx);
      return;
    }
    
    if (adminAction.action === 'reset_user') {
      await resetUserRole(ctx, targetId);
    } else if (adminAction.action === 'delete_user') {
      await deleteUser(ctx, targetId);
    } else if (adminAction.action === 'edit_user') {
      adminSession.set(telegramId, { action: 'edit_user_role', step: 2, targetId });
      await ctx.reply('Masukkan role baru (ADMIN, SOAREA, TIF, TA):');
      return;
    }
    adminSession.delete(telegramId);
    await showUserManagementMenu(ctx);
    return;
  }
  
  const editAction = adminSession.get(telegramId);
  if (editAction && editAction.action === 'edit_user_role' && editAction.step === 2 && isPrivateChat(ctx)) {
    const newRole = pesan.toUpperCase();
    if (!['ADMIN', 'SOAREA', 'TIF', 'TA'].includes(newRole)) {
      await ctx.reply('Role tidak valid. Gunakan: ADMIN, SOAREA, TIF, TA');
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
        await ctx.reply('Masukkan NIK Anda:');
        break;
      case 2:
        session.data.nik = pesan;
        session.step = 3;
        await ctx.reply('Masukkan Nomor HP Anda:');
        break;
      case 3:
        session.data.noHp = pesan;
        session.step = 4;
        await ctx.reply('Masukkan Perusahaan Anda:');
        break;
      case 4:
        session.data.perusahaan = pesan;
        session.step = 5;
        const lokerKeyboard = Markup.inlineKeyboard([
          [Markup.button.callback('ROC-2', 'loker_ROC-2')],
          [Markup.button.callback('JAKUT', 'loker_JAKUT'), Markup.button.callback('JAKPUS', 'loker_JAKPUS'), Markup.button.callback('JAKTIM', 'loker_JAKTIM')],
          [Markup.button.callback('JAKBAR', 'loker_JAKBAR'), Markup.button.callback('JAKSEL', 'loker_JAKSEL')],
          [Markup.button.callback('BEKASI', 'loker_BEKASI'), Markup.button.callback('BANTEN', 'loker_BANTEN'), Markup.button.callback('BOGOR', 'loker_BOGOR')],
          [Markup.button.callback('TANGERANG', 'loker_TANGERANG'), Markup.button.callback('EOS/DA', 'loker_EOS/DA')]
        ]);
        await ctx.reply('Pilih District/Loker:', lokerKeyboard);
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
    const isRegistered = await isUserRegistered(telegramId);
    
    if (!isRegistered || !userRole) {
      return;
    }
    
    if (pesan.includes('#REQORBIT') && pesan.includes('#PINDAHUPLINK')) {
      const { customer, kodePerangkat, noTiket, layanan, witelSto, datekMetro } = parseRequestMessage(pesan);
      
      if (!customer || !kodePerangkat) {
        await ctx.reply('Format tidak lengkap. Pastikan ada "Customer : ..." dan "kode Perangkat Orbit : ..."');
        return;
      }
      
      const orderNumber = await generateOrderNumber();
      const order = await prisma.order.create({
        data: {
          orderNumber,
          customer,
          kodePerangkat,
          noTiket: noTiket || '-',
          layanan: layanan || '-',
          witelSto: witelSto || '-',
          datekMetro: datekMetro || '-',
          requesterNik: ctx.from.id.toString(),
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

// ==================== JALANKAN BOT UNTUK LOKAL ====================
bot.launch().then(() => console.log('🤖 Bit Assistant running locally...'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));