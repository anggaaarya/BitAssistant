import { prisma, isAdmin, isUserRegistered, getUserRole } from '../database';
import { isGroupChat, isPrivateChat } from '../utils';
import { showAdminMenu } from '../menus/admin';
import { showStatusCommand } from '../menus/orbit';
import { showRollbackMenu } from '../menus/orbit';
import { startRegistration, showRoleSelection } from './registration';

export function registerCommands(bot: any) {
  bot.command('start', async (ctx: any) => {
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

  bot.command('adduser', async (ctx: any) => {
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

  bot.command('role', async (ctx: any) => {
    if (!isPrivateChat(ctx)) {
      await ctx.reply('⚠️ Command /role hanya bisa digunakan di private chat.');
      return;
    }
    if (!await isAdmin(ctx.from.id)) {
      await ctx.reply('⛔ Hanya admin yang bisa mengubah role.');
      return;
    }
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      await ctx.reply('Format: /role <telegramId> <role>\nRole: ADMIN, SOAREA, TIF, TA');
      return;
    }
    const telegramId = parseInt(args[1]);
    const newRole = args[2].toUpperCase();
    if (isNaN(telegramId)) {
      await ctx.reply('❌ telegramId harus berupa angka.');
      return;
    }
    if (!['ADMIN', 'SOAREA', 'TIF', 'TA'].includes(newRole)) {
      await ctx.reply('❌ Role tidak valid. Gunakan: ADMIN, SOAREA, TIF, TA');
      return;
    }
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply(`❌ User dengan ID ${telegramId} tidak ditemukan.`);
      return;
    }
    await prisma.user.update({ where: { telegramId }, data: { role: newRole } });
    await ctx.reply(`✅ Role user @${user.username} (ID: ${telegramId}) berhasil diubah menjadi ${newRole}.`);
  });

  bot.command('status', async (ctx: any) => {
    if (!isGroupChat(ctx)) return;
    const userRole = await getUserRole(ctx.from.id);
    if (!userRole) return;
    await showStatusCommand(ctx);
  });

  bot.command('rollback', async (ctx: any) => {
    if (!isGroupChat(ctx)) return;
    const userRole = await getUserRole(ctx.from.id);
    if (!userRole) return;
    await showRollbackMenu(ctx);
  });

  bot.command('help', async (ctx: any) => {
    const helpText = `🤖 *Bit Assistant - Panduan Penggunaan*

*📌 Command yang tersedia:*

1. /start - Memulai bot, registrasi (di private chat), atau menu admin
2. /help - Menampilkan panduan ini
3. /status - Melihat daftar orbit aktif di grup ini
4. /rollback - Menampilkan daftar orbit aktif untuk di-rollback (di grup)
5. /adduser - Menambah user baru (hanya ADMIN)
6. /role - Mengubah role user (hanya ADMIN, di private chat)

*📌 Cara Membuat Request:*
Kirim pesan di GRUP dengan format:
#REQORBIT #PINDAHUPLINK

No tiket/lapsung : ...
customer: ...
layanan : ...
Perangkat Orbit : ...
STO : ...
Datek Metro Eksisting (contoh:ME-D2-CPP 1/2/3:3125) : ...

*📌 Alur Request:*
1. TIF/TA membuat request
2. ADMIN/SOAREA klik Accept
3. ADMIN/SOAREA klik Selesai
4. Orbit muncul di Status Orbit

*📌 Rollback:*
- Klik tombol ↩️ Rollback di pesan order yang sudah selesai
- Atau ketik /rollback di grup, pilih orbit, lalu klik Selesai

*📌 Manajemen User (ADMIN):*
- /adduser <telegramId> <username> <role> - Menambah user baru
- /role <telegramId> <role> - Mengubah role user (di private chat)

*📌 Catatan:*
- Registrasi hanya bisa dilakukan di PRIVATE CHAT (DM)
- Request hanya bisa dibuat di GRUP
- Data terisolasi per grup (tidak tercampur)

© Bit Assistant Bot`;
    await ctx.reply(helpText, { parse_mode: 'Markdown' });
  });
}