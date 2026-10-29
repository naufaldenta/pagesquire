/**
 * Built-in visitor-facing copy. Keys are stable; hosts override any subset
 * with `messages` or add a language by passing a full set. `{name}`
 * placeholders are filled by the component that shows the text.
 */
export const en = {
  'widget.title': 'PageSquire',
  'widget.label': 'PageSquire assistant',
  'widget.inputLabel': 'How can I help with this page?',
  'widget.placeholder': 'Try “Make headings red”',
  'widget.send': 'Send',
  'widget.stop': 'Stop',
  'widget.newConversation': 'New conversation',
  'widget.conversation': 'Conversation',
  'widget.statusThinking': 'Thinking… You can stop at any time.',
  'widget.statusActing': '{stage}: {capability}. You can stop at any time.',
  'widget.statusReady': 'Ready · {emotion}',
  'widget.statusServer': '{stage} You can stop at any time.',
  'server.accepted': 'Request received…',
  'server.thinking': 'The assistant is thinking…',
  'server.reviewing': 'Checking that the task is done…',
  'server.replaying': 'Repeating a verified plan…',
  'widget.you': 'You: {text}',
  'widget.progress': 'Action progress',
  'widget.progressNote': 'Observed browser stages · recent 20 attempts',
  'widget.recentActions': 'Recent actions',
  'widget.observedStages': 'Observed stages',

  'approval.title': 'Approve this action?',
  'approval.approve': 'Approve',
  'approval.deny': 'Deny',
  'client.plan': 'Plan:',
  'visitor.questionTitle': 'The assistant has a question',
  'visitor.handoffTitle': 'Your turn',
  'visitor.handoffHelp':
    'Finish this step yourself, then press the button. The assistant waits and never receives what you type into fields.',
  'visitor.done': "I'm done",
  'visitor.cancel': 'Cancel',
  'visitor.linkTitle': 'Continue on {name}?',
  'visitor.linkOrigin':
    '{origin} opens in a new tab. Only your request and the details below are shared.',
  'visitor.linkContinue': 'Continue on {name}',
  'link.arrivalTitle': 'Continue from a partner site',
  'link.arrivalText':
    'A partner site sent you here with your request. Continue to let this assistant pick it up.',
  'link.continue': 'Continue',
  'link.dismiss': 'Dismiss',
  'error.handoffExpired':
    'This handoff expired or was already used. Ask your question here instead.',

  'tour.label': 'PageSquire guided tour',
  'tour.previous': 'Previous',
  'tour.next': 'Next',
  'tour.finish': 'Finish',
  'tour.stop': 'Stop tour',

  'stage.checking': 'Checking',
  'stage.checking.help':
    'Checking the registered action, parameters and current page.',
  'stage.executing': 'Executing',
  'stage.executing.help':
    'Running the registered action. Completion is not yet verified.',
  'stage.verifying': 'Verifying',
  'stage.verifying.help':
    'Checking the actual result against the registered postcondition.',
  'stage.navigation_pending': 'Awaiting destination',
  'stage.navigation_pending.help':
    'Navigation started, not verified. Destination verification requires the configured continuation.',
  'stage.verified': 'Verified',
  'stage.verified.help':
    'The registered postcondition passed. This is not proof of every part of your request.',
  'stage.unverified': 'Not verified',
  'stage.unverified.help':
    'The postcondition did not pass. Check the page before making a new request; changes are not rolled back.',
  'stage.cancelled': 'Stopped',
  'stage.cancelled.help':
    'Stopped waiting. Existing or in-flight changes are not rolled back. Check the page before trying again.',
  'stage.timed_out': 'Timed out',
  'stage.timed_out.help':
    'The time limit expired. An in-flight handler may still finish. Check the page before trying again.',
  'stage.replayed': 'Cached result',
  'stage.replayed.help':
    'Reused a recorded result; the action was not run or verified again.',
  'stage.failed': 'Failed',
  'recovery.unavailable':
    'This action is unavailable in the current app state. Finish loading or update the required selection, then make a new request.',
  'recovery.stale':
    'The page changed. Check its current state, then make a new request.',
  'recovery.target':
    'A unique public target could not be found. Open the relevant section or ask the site owner to review the binding.',
  'recovery.permission':
    'The registered permissions do not allow this action. Ask for a supported action; the assistant cannot grant itself access.',
  'recovery.rejected':
    'The action request was rejected. Make a new request; repeated failures need an integration review.',
  'recovery.busy':
    'Another action is active. Wait for it to finish or stop it before making a new request.',
  'recovery.limit':
    'The browser session action limit was reached. Contact the site owner; no automatic retry was made.',
  'recovery.navigation':
    'The destination could not be verified safely. Check the page and start a new conversation.',
  'recovery.verification':
    'The verifier returned an invalid result. Check the page and ask the site owner to review the integration.',
  'recovery.approval':
    'The action needed your approval and did not run. Ask again if you want it.',
  'recovery.visitor':
    'This step needed your answer or your turn and did not continue. Ask again when you are ready.',
  'recovery.element':
    'The element was hidden, disabled, covered or moving. Check the page, then make a new request.',
  'recovery.default':
    'The registered action or verifier failed. Check the page before trying again; no automatic retry or rollback was performed.',

  'error.network': 'The assistant server could not be reached.',
  'error.http403':
    'Your assistant access is unavailable. Reload the page and try again.',
  'error.http409':
    'This conversation expired or another request is running. Wait, then start a new conversation.',
  'error.http413':
    'This conversation is too large. Start a new conversation with a shorter request.',
  'error.http419': 'Your session expired. Reload the page and try again.',
  'error.http429':
    'The usage limit was reached. Wait before trying again; starting a new conversation does not reset it.',
  'error.http502':
    'The AI provider could not return a valid response. Try a new message or start a new conversation.',
  'error.http503':
    'The assistant service is temporarily unavailable. Please try again later.',
  'error.httpOther':
    'The assistant request was rejected. Start a new conversation or try again later.',
  'error.capabilityDenied':
    'The AI requested an action this page does not allow. Please describe a supported page action.',
  'error.capabilityUnavailable':
    'This action is not available in the current page state. Check the required selection or wait for the page to be ready, then send a new message.',
  'error.emptyResponse': 'The assistant response is empty.',
  'error.responseTooLarge': 'The assistant response is too large.',
  'error.invalidResponse': 'The assistant response is invalid.',

  'client.cancelled': 'The conversation was cancelled.',
  'client.timedOut': 'The conversation timed out.',
  'client.busy': 'A conversation is already running.',
  'client.cancelFirst': 'Cancel the current conversation first.',
  'client.invalidMessage': 'Enter a message of up to 4000 characters.',
  'client.navigationLost':
    'The pending navigation could not be restored. Start a new conversation.',
  'client.invalidReply': 'The assistant response does not match the protocol.',
  'client.conversationChanged':
    'The assistant conversation changed unexpectedly.',
  'client.oneAction': 'Request exactly one action per response.',
  'client.staleSnapshot': 'The assistant action uses an outdated snapshot.',
  'client.notVerified':
    'I could not verify that the previous action completed. No further actions were run.',
  'client.couldNotVerify': 'I could not verify that the action completed.',
  'client.roundLimitNavigation':
    'The conversation limit was reached before navigation.',
  'client.navigationResume':
    'Navigation started. The assistant will verify the destination.',
  'client.navigationReopen':
    'Navigation started. Reopen the assistant on the destination page.',
  'client.roundLimit':
    'The conversation limit was reached. Start a new conversation.',
  'client.unexpected':
    'The assistant could not complete this request. Try again.',
};

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const id: Messages = {
  'widget.title': 'PageSquire',
  'widget.label': 'Asisten PageSquire',
  'widget.inputLabel': 'Apa yang bisa saya bantu di halaman ini?',
  'widget.placeholder': 'Coba “Buat judul jadi merah”',
  'widget.send': 'Kirim',
  'widget.stop': 'Hentikan',
  'widget.newConversation': 'Percakapan baru',
  'widget.conversation': 'Percakapan',
  'widget.statusThinking':
    'Sedang berpikir… Kamu bisa menghentikannya kapan saja.',
  'widget.statusActing':
    '{stage}: {capability}. Kamu bisa menghentikannya kapan saja.',
  'widget.statusReady': 'Siap · {emotion}',
  'widget.statusServer': '{stage} Kamu bisa menghentikannya kapan saja.',
  'server.accepted': 'Permintaan diterima…',
  'server.thinking': 'Asisten sedang berpikir…',
  'server.reviewing': 'Memeriksa apakah tugas sudah selesai…',
  'server.replaying': 'Mengulang rencana yang sudah terverifikasi…',
  'widget.you': 'Kamu: {text}',
  'widget.progress': 'Progres aksi',
  'widget.progressNote':
    'Tahap yang teramati di browser · 20 percobaan terakhir',
  'widget.recentActions': 'Aksi terbaru',
  'widget.observedStages': 'Tahap yang teramati',

  'approval.title': 'Setujui aksi ini?',
  'approval.approve': 'Setujui',
  'approval.deny': 'Tolak',
  'client.plan': 'Rencana:',
  'visitor.questionTitle': 'Asisten punya pertanyaan',
  'visitor.handoffTitle': 'Giliranmu',
  'visitor.handoffHelp':
    'Selesaikan langkah ini sendiri, lalu tekan tombolnya. Asisten menunggu dan tidak pernah menerima isi yang kamu ketik di kolom.',
  'visitor.done': 'Sudah selesai',
  'visitor.cancel': 'Batal',
  'visitor.linkTitle': 'Lanjut di {name}?',
  'visitor.linkOrigin':
    '{origin} terbuka di tab baru. Hanya permintaanmu dan detail di bawah ini yang dibagikan.',
  'visitor.linkContinue': 'Lanjut di {name}',
  'link.arrivalTitle': 'Lanjutan dari situs mitra',
  'link.arrivalText':
    'Situs mitra mengirimmu ke sini dengan permintaanmu. Pilih Lanjutkan agar asisten di sini meneruskannya.',
  'link.continue': 'Lanjutkan',
  'link.dismiss': 'Tutup',
  'error.handoffExpired':
    'Lanjutan ini sudah kedaluwarsa atau sudah dipakai. Tanyakan langsung di sini.',

  'tour.label': 'Tur terpandu PageSquire',
  'tour.previous': 'Sebelumnya',
  'tour.next': 'Berikutnya',
  'tour.finish': 'Selesai',
  'tour.stop': 'Hentikan tur',

  'stage.checking': 'Memeriksa',
  'stage.checking.help':
    'Memeriksa aksi yang terdaftar, parameternya, dan halaman saat ini.',
  'stage.executing': 'Menjalankan',
  'stage.executing.help':
    'Menjalankan aksi yang terdaftar. Hasilnya belum terverifikasi.',
  'stage.verifying': 'Memverifikasi',
  'stage.verifying.help':
    'Mencocokkan hasil sebenarnya dengan kondisi akhir yang terdaftar.',
  'stage.navigation_pending': 'Menunggu halaman tujuan',
  'stage.navigation_pending.help':
    'Navigasi dimulai tetapi belum terverifikasi. Verifikasi halaman tujuan memerlukan kelanjutan yang dikonfigurasi.',
  'stage.verified': 'Terverifikasi',
  'stage.verified.help':
    'Kondisi akhir yang terdaftar terpenuhi. Ini belum membuktikan setiap bagian permintaanmu.',
  'stage.unverified': 'Belum terverifikasi',
  'stage.unverified.help':
    'Kondisi akhir tidak terpenuhi. Periksa halaman sebelum membuat permintaan baru; perubahan tidak dibatalkan.',
  'stage.cancelled': 'Dihentikan',
  'stage.cancelled.help':
    'Berhenti menunggu. Perubahan yang sudah atau sedang terjadi tidak dibatalkan. Periksa halaman sebelum mencoba lagi.',
  'stage.timed_out': 'Waktu habis',
  'stage.timed_out.help':
    'Batas waktu habis. Proses yang sedang berjalan mungkin masih selesai. Periksa halaman sebelum mencoba lagi.',
  'stage.replayed': 'Hasil tersimpan',
  'stage.replayed.help':
    'Memakai hasil yang sudah tercatat; aksi tidak dijalankan atau diverifikasi ulang.',
  'stage.failed': 'Gagal',
  'recovery.unavailable':
    'Aksi ini tidak tersedia pada kondisi halaman saat ini. Tunggu halaman selesai dimuat atau ubah pilihan yang diperlukan, lalu buat permintaan baru.',
  'recovery.stale':
    'Halaman sudah berubah. Periksa kondisinya sekarang, lalu buat permintaan baru.',
  'recovery.target':
    'Target publik yang unik tidak ditemukan. Buka bagian yang relevan atau minta pemilik situs meninjau integrasinya.',
  'recovery.permission':
    'Izin yang terdaftar tidak mengizinkan aksi ini. Minta aksi yang didukung; asisten tidak bisa memberi izin untuk dirinya sendiri.',
  'recovery.rejected':
    'Permintaan aksi ditolak. Buat permintaan baru; kegagalan berulang perlu ditinjau oleh pemilik situs.',
  'recovery.busy':
    'Ada aksi lain yang sedang berjalan. Tunggu sampai selesai atau hentikan dulu sebelum membuat permintaan baru.',
  'recovery.limit':
    'Batas aksi untuk sesi browser ini sudah tercapai. Hubungi pemilik situs; tidak ada percobaan ulang otomatis.',
  'recovery.navigation':
    'Halaman tujuan tidak bisa diverifikasi dengan aman. Periksa halaman dan mulai percakapan baru.',
  'recovery.verification':
    'Pemeriksa hasil mengembalikan hasil yang tidak valid. Periksa halaman dan minta pemilik situs meninjau integrasinya.',
  'recovery.approval':
    'Aksi ini memerlukan persetujuanmu dan tidak dijalankan. Minta lagi jika kamu menginginkannya.',
  'recovery.visitor':
    'Langkah ini butuh jawaban atau giliranmu dan tidak dilanjutkan. Minta lagi kalau kamu sudah siap.',
  'recovery.element':
    'Elemennya tersembunyi, nonaktif, tertutup elemen lain, atau masih bergerak. Periksa halaman, lalu buat permintaan baru.',
  'recovery.default':
    'Aksi atau pemeriksa hasil yang terdaftar gagal. Periksa halaman sebelum mencoba lagi; tidak ada percobaan ulang atau pembatalan otomatis.',

  'error.network': 'Server asisten tidak dapat dihubungi.',
  'error.http403':
    'Akses asisten tidak tersedia. Muat ulang halaman lalu coba lagi.',
  'error.http409':
    'Percakapan ini kedaluwarsa atau ada permintaan lain yang sedang berjalan. Tunggu sebentar, lalu mulai percakapan baru.',
  'error.http413':
    'Percakapan ini terlalu panjang. Mulai percakapan baru dengan permintaan yang lebih singkat.',
  'error.http419': 'Sesimu sudah berakhir. Muat ulang halaman lalu coba lagi.',
  'error.http429':
    'Batas penggunaan sudah tercapai. Tunggu sebelum mencoba lagi; memulai percakapan baru tidak mengatur ulang batas ini.',
  'error.http502':
    'Penyedia AI tidak memberikan respons yang valid. Coba kirim pesan baru atau mulai percakapan baru.',
  'error.http503':
    'Layanan asisten sedang tidak tersedia. Silakan coba lagi nanti.',
  'error.httpOther':
    'Permintaan ke asisten ditolak. Mulai percakapan baru atau coba lagi nanti.',
  'error.capabilityDenied':
    'AI meminta aksi yang tidak diizinkan di halaman ini. Coba jelaskan aksi yang didukung halaman ini.',
  'error.capabilityUnavailable':
    'Aksi ini tidak tersedia pada kondisi halaman saat ini. Periksa pilihan yang diperlukan atau tunggu halaman siap, lalu kirim pesan baru.',
  'error.emptyResponse': 'Respons asisten kosong.',
  'error.responseTooLarge': 'Respons asisten terlalu besar.',
  'error.invalidResponse': 'Respons asisten tidak valid.',

  'client.cancelled': 'Percakapan dibatalkan.',
  'client.timedOut': 'Waktu percakapan habis.',
  'client.busy': 'Masih ada percakapan yang sedang berjalan.',
  'client.cancelFirst':
    'Hentikan percakapan yang sedang berjalan terlebih dahulu.',
  'client.invalidMessage': 'Tulis pesan dengan panjang maksimal 4000 karakter.',
  'client.navigationLost':
    'Navigasi yang tertunda tidak bisa dipulihkan. Mulai percakapan baru.',
  'client.invalidReply': 'Respons asisten tidak sesuai protokol.',
  'client.conversationChanged':
    'Percakapan asisten berubah secara tak terduga.',
  'client.oneAction': 'Setiap respons hanya boleh berisi satu aksi.',
  'client.staleSnapshot':
    'Aksi asisten memakai gambaran halaman yang sudah usang.',
  'client.notVerified':
    'Saya tidak bisa memastikan aksi sebelumnya berhasil. Tidak ada aksi lain yang dijalankan.',
  'client.couldNotVerify': 'Saya tidak bisa memastikan aksi itu berhasil.',
  'client.roundLimitNavigation': 'Batas percakapan tercapai sebelum navigasi.',
  'client.navigationResume':
    'Navigasi dimulai. Asisten akan memverifikasi halaman tujuan.',
  'client.navigationReopen':
    'Navigasi dimulai. Buka kembali asisten di halaman tujuan.',
  'client.roundLimit':
    'Batas percakapan sudah tercapai. Mulai percakapan baru.',
  'client.unexpected':
    'Asisten tidak bisa menyelesaikan permintaan ini. Coba lagi.',
};

export type Locale = 'en' | 'id';
export const locales: Readonly<Record<Locale, Messages>> = Object.freeze({
  en,
  id,
});

export interface LocaleOptions {
  /** 'auto' (default) follows `<html lang>`; unknown languages fall back to English. */
  locale?: Locale | 'auto';
  /** Overrides for individual keys, e.g. a site's own wording. */
  messages?: Partial<Messages>;
}

/** The built-in locale for a language tag such as "id-ID"; English otherwise. */
export function localeFor(tag: string | null | undefined): Locale {
  const primary = String(tag ?? '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return primary === 'id' || primary === 'in' ? 'id' : 'en';
}

export function resolveMessages(
  options: LocaleOptions = {},
  document?: Document,
): Messages {
  const locale =
    options.locale && options.locale !== 'auto'
      ? options.locale
      : localeFor(
          (document ?? globalThis.document)?.documentElement?.lang ?? '',
        );
  const base = locales[locale] ?? en;
  const result = { ...base };
  for (const [key, value] of Object.entries(options.messages ?? {}))
    if (key in en && typeof value === 'string')
      result[key as MessageKey] = value;
  return result;
}

/** Fills `{name}` placeholders; unknown placeholders are left as written. */
export function format(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : match,
  );
}
