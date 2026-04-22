import { getUserRole, isUserRegistered, prisma } from '../database';
import { isGroupChat, isPrivateChat, getChatId, parseRequestMessage, generateOrderNumber, sendOrEditOrderMessage } from '../utils';
import { adminSession, showUserManagementMenu, resetUserRole, deleteUser, editUserRole } from '../menus/admin';
import { processRegistrationText } from './registration';

export async function handleTextMessage(ctx: any) {
  const pesan = ctx.message.text;
  const telegramId = ctx.from.id;
  const chatId = getChatId(ctx);

  // Handle admin session for ID input
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
  
  // Handle admin session for edit role
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

  // Handle registration
  const registered = await processRegistrationText(ctx, telegramId, pesan);
  if (registered) return;

  // Handle group chat - process request
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
      
      // Check duplicate active device (status 'done')
      const existingActiveDevice = await prisma.order.findFirst({
        where: {
          kodePerangkat: kodePerangkat,
          status: 'done'
        }
      });
      
      if (existingActiveDevice) {
        await ctx.reply(`❌ Perangkat ${kodePerangkat} sudah aktif. Silakan lakukan /rollback terlebih dahulu.`);
        return;
      }
      
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
}