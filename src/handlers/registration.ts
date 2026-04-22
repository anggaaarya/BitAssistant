import { Markup } from 'telegraf';
import { prisma } from '../database';
import { isPrivateChat } from '../utils';

export const registrationSession = new Map<number, any>();

export async function startRegistration(ctx: any) {
  if (!isPrivateChat(ctx)) return;
  registrationSession.set(ctx.from.id, { step: 1, data: {} });
  await ctx.reply('📝 Registrasi\nMasukkan Nama lengkap Anda:');
}

export async function completeRegistration(ctx: any, telegramId: number, data: any) {
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

export async function showRoleSelection(ctx: any) {
  if (!isPrivateChat(ctx)) return;
  await ctx.reply('✅ Registrasi berhasil!\nPilih role Anda:', Markup.inlineKeyboard([
    [Markup.button.callback('📋 TIF District', 'role_TIF')],
    [Markup.button.callback('🔧 TA', 'role_TA')],
    [Markup.button.callback('⭐ SO Area (Hubungi Admin)', 'role_SOAREA')]
  ]));
}

export async function processRegistrationText(ctx: any, telegramId: number, pesan: string) {
  const session = registrationSession.get(telegramId);
  if (!session) return false;

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
  return true;
}