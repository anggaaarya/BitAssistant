import { Markup } from 'telegraf';
import { prisma } from '../database';
import { getChatId } from '../utils';

export async function showAdminMenu(ctx: any) {
  await ctx.reply('Menu Admin', Markup.inlineKeyboard([
    [Markup.button.callback('📋 Kelola User', 'admin_kelola_user')],
    [Markup.button.callback('📊 Status Orbit', 'admin_status_orbit')],
    [Markup.button.callback('❌ Tutup Menu', 'admin_close_menu')]
  ]));
}

export async function showUserManagementMenu(ctx: any) {
  await ctx.reply('Kelola User', Markup.inlineKeyboard([
    [Markup.button.callback('👥 Lihat User', 'admin_lihat_user')],
    [Markup.button.callback('🔄 Reset User', 'admin_reset_user')],
    [Markup.button.callback('🗑️ Hapus User', 'admin_hapus_user')],
    [Markup.button.callback('✏️ Edit User', 'admin_edit_user')],
    [Markup.button.callback('🔙 Kembali', 'admin_back_to_menu')]
  ]));
}

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

export async function showAllUsers(ctx: any) {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  if (!users.length) {
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

export async function resetUserRole(ctx: any, targetId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User ID ${targetId} tidak ditemukan.`);
    return;
  }
  await prisma.user.update({ where: { telegramId: targetId }, data: { role: '' } });
  await ctx.reply(`Role user @${user.username} telah di-reset.`);
}

export async function deleteUser(ctx: any, targetId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User ID ${targetId} tidak ditemukan.`);
    return;
  }
  await prisma.user.delete({ where: { telegramId: targetId } });
  await ctx.reply(`User @${user.username} telah dihapus.`);
}

export async function editUserRole(ctx: any, targetId: number, newRole: string) {
  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.reply(`User ID ${targetId} tidak ditemukan.`);
    return;
  }
  await prisma.user.update({ where: { telegramId: targetId }, data: { role: newRole } });
  await ctx.reply(`Role user @${user.username} diubah menjadi ${newRole}.`);
}

export const adminSession = new Map<number, any>();