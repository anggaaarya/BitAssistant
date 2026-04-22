import { prisma, isAdmin, isAdminOrSO } from '../database';
import { sendOrEditOrderMessage, getChatId } from '../utils';
import { 
  showUserManagementMenu, 
  showAllUsers, 
  resetUserRole, 
  deleteUser, 
  editUserRole, 
  showStatusOrbit, 
  showAdminMenu,
  adminSession 
} from '../menus/admin';
import { handleRollbackSelect, handleRollbackComplete, handleRollbackCancel, handleRollbackFromButton } from '../menus/orbit';
import { registrationSession, showRoleSelection } from './registration';

export function registerCallbacks(bot: any) {
  // Role selection
  bot.action('role_TIF', async (ctx: any) => {
    await prisma.user.update({ where: { telegramId: ctx.from.id }, data: { role: 'TIF' } });
    await ctx.answerCbQuery('✅ Role TIF District dipilih');
    await ctx.reply('Anda terdaftar sebagai TIF District.');
  });

  bot.action('role_TA', async (ctx: any) => {
    await prisma.user.update({ where: { telegramId: ctx.from.id }, data: { role: 'TA' } });
    await ctx.answerCbQuery('✅ Role TA dipilih');
    await ctx.reply('Anda terdaftar sebagai TA.');
  });

  bot.action('role_SOAREA', async (ctx: any) => {
    await ctx.answerCbQuery('Hubungi Admin');
    await ctx.reply('Role SO Area hanya bisa ditambahkan oleh admin. Hubungi @mmdafiq.');
  });

  // Loker selection
  bot.action(/loker_(.+)/, async (ctx: any) => {
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

  // Admin menu callbacks
  bot.action('admin_kelola_user', async (ctx: any) => {
    if (await isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery();
      await showUserManagementMenu(ctx);
    }
  });

  bot.action('admin_status_orbit', async (ctx: any) => {
    if (await isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery();
      await showStatusOrbit(ctx);
      await showAdminMenu(ctx);
    }
  });

  bot.action('admin_back_to_menu', async (ctx: any) => {
    if (await isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery();
      await showAdminMenu(ctx);
    }
  });

  bot.action('admin_close_menu', async (ctx: any) => {
    await ctx.answerCbQuery('Menu ditutup');
    await ctx.deleteMessage();
  });

  bot.action('admin_lihat_user', async (ctx: any) => {
    if (await isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery();
      await showAllUsers(ctx);
      await showUserManagementMenu(ctx);
    }
  });

  bot.action('admin_reset_user', async (ctx: any) => {
    if (await isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery();
      adminSession.set(ctx.from.id, { action: 'reset_user' });
      await ctx.reply('Masukkan ID Telegram user:');
    }
  });

  bot.action('admin_hapus_user', async (ctx: any) => {
    if (await isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery();
      adminSession.set(ctx.from.id, { action: 'delete_user' });
      await ctx.reply('Masukkan ID Telegram user:');
    }
  });

  bot.action('admin_edit_user', async (ctx: any) => {
    if (await isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery();
      adminSession.set(ctx.from.id, { action: 'edit_user' });
      await ctx.reply('Masukkan ID Telegram user:');
    }
  });

  // Rollback callbacks
  bot.action(/rollback_select_(\d+)/, async (ctx: any) => {
    const orderId = parseInt(ctx.match[1]);
    await handleRollbackSelect(ctx, orderId);
  });

  bot.action(/rollback_complete_(\d+)/, async (ctx: any) => {
    const orderId = parseInt(ctx.match[1]);
    await handleRollbackComplete(ctx, orderId);
  });

  bot.action(/rollback_cancel_(\d+)/, async (ctx: any) => {
    const orderId = parseInt(ctx.match[1]);
    await handleRollbackCancel(ctx, orderId);
  });

  bot.action(/rollback_(\d+)/, async (ctx: any) => {
    const orderId = parseInt(ctx.match[1]);
    await handleRollbackFromButton(ctx, orderId);
  });

  // Order action callbacks
  bot.action(/accept_(\d+)/, async (ctx: any) => {
    if (!await isAdminOrSO(ctx.from.id)) {
      await ctx.answerCbQuery('Tidak punya akses');
      return;
    }
    const orderId = parseInt(ctx.match[1]);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const currentChatId = getChatId(ctx);
    
    if (!order || order.chatId !== currentChatId) {
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

  bot.action(/reject_(\d+)/, async (ctx: any) => {
    if (!await isAdminOrSO(ctx.from.id)) {
      await ctx.answerCbQuery('Tidak punya akses');
      return;
    }
    const orderId = parseInt(ctx.match[1]);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const currentChatId = getChatId(ctx);
    
    if (!order || order.chatId !== currentChatId) {
      await ctx.answerCbQuery('❌ Data ini dari grup lain!');
      return;
    }
    
    const updatedOrder = await prisma.order.update({ where: { id: orderId }, data: { status: 'rejected' } });
    await ctx.answerCbQuery('Order ditolak');
    await ctx.reply(`Order ${updatedOrder.orderNumber} - DITOLAK`);
  });

  bot.action(/done_(\d+)/, async (ctx: any) => {
    if (!await isAdminOrSO(ctx.from.id)) {
      await ctx.answerCbQuery('Tidak punya akses');
      return;
    }
    const orderId = parseInt(ctx.match[1]);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const currentChatId = getChatId(ctx);
    
    if (!order || order.chatId !== currentChatId) {
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

  bot.action(/cancel_(\d+)/, async (ctx: any) => {
    if (!await isAdminOrSO(ctx.from.id)) {
      await ctx.answerCbQuery('Tidak punya akses');
      return;
    }
    const orderId = parseInt(ctx.match[1]);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const currentChatId = getChatId(ctx);
    
    if (!order || order.chatId !== currentChatId) {
      await ctx.answerCbQuery('❌ Data ini dari grup lain!');
      return;
    }
    
    const updatedOrder = await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
    await ctx.answerCbQuery('Order dibatalkan');
    await ctx.reply(`Order ${updatedOrder.orderNumber} - DIBATALKAN`);
  });
}