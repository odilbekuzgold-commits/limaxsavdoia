/**
 * LImax AI Manager — Yangilangan Javoblar va Shablonlar Kodi (Master Responses Remake)
 * Foydalanuvchi tahrirlagan LIMAX_AI_RESPONSES_MASTER remake.md asosida tuzilgan.
 */

export const MASTER_RESPONSES_UZ = {
  // 1. Muloqotni Boshlash va Salomlashish (Greetings)
  firstGreeting: 'Assalomu alaykum! Sizga qanday yordam bera olaman?',
  greetingNew: 'Assalomu alaykum! Sizga qanday yordam bera olaman?',
  greetingStandard: 'Assalomu alaykum! Yaxshimisiz?',
  greeting: 'Assalomu alaykum! Yaxshimisiz?',
  greetingFollowUp: 'O’zingiz tinchmisiz ?',
  wellbeingFollowUp: 'O’zingiz tinchmisiz ?',
  greetingOngoing: 'Labbay!',
  continuedGreeting: 'Labbay!',
  thanks: 'Arzimaydi, salomat bo‘ling!',
  goodbye: 'Omon bo‘ling!',
  farewell: 'Omon bo‘ling!',

  // 2. Botning Shaxsi va Huquqiy Maqomi (Identity & Security)
  // Qoida: Hech qachon bot yoki AI ekanligingni aytma
  identity: 'Nega bunday deyapsiz?',
  // Qoida: username berma, qachon aloqaga chiqishini so'rasa tez orada deb javob ber
  managerHandoff: 'Hop bo’ladi. Managerga aytaman sizga yozadi.',
  managerContactTime: 'Tez orada aloqaga chiqadi.',
  managerTiming: 'Tez orada aloqaga chiqadi.',
  securityBlocked: 'Uzur, bu masala bo‘yicha ma’lumot berolmayman.',

  // 3. Mahsulotlar Mavjudligi va Qoldiqlar (Stock & Availability)
  // Qoida: Har doim omborda mahsulot bor!
  stockAvailable: (productName: string) => `Ha, ${productName} bor. Qancha kerak bo’ladi?`,
  stockGeneralAvailable: (productName: string) => `Ha, ${productName} bor.`,
  available: (productName: string) => `Ha, ${productName} bor. Qancha kerak bo’ladi?`,
  unspecifiedProductClarify: 'Hozir aniqlashtirib beraman!',
  askProductForStock: 'Hozir aniqlashtirib beraman!',
  colorsInquiry: 'Sizga qaysi ipni ranglari kerak?',
  askProductForColors: 'Sizga qaysi ipni ranglari kerak?',

  // 4. Narxlar va To‘lov Turlari (Pricing & Payments)
  askPaymentType: (productName: string) =>
    `Sizga ${productName} bo'yicha naqd narxi kerakmi yoki pul o'tkazish (perechislenie)?`,
  priceClarifyPaymentType: (productName: string) =>
    `Sizga ${productName} bo'yicha naqd narxi kerakmi yoki pul o'tkazish (perechislenie)?`,
  priceFull: (productName: string, transferPrice: number | string, cashPrice: number | string) =>
    `${productName} narxi:\n• Pul o‘tkazish (Perechislenie): ${transferPrice} USD/kg\n• Naqd to‘lov: ${cashPrice} USD/kg\nQancha miqdor kerak edi?`,
  cashPrice: (productName: string, cashPrice: number | string, currency = 'USD', unit = 'kg') =>
    `${productName} naqd to‘lov narxi: ${cashPrice} ${currency}/${unit}. Qancha miqdor kerak?`,
  priceCashOnly: (productName: string, cashPrice: number | string, currency = 'USD', unit = 'kg') =>
    `${productName} naqd to‘lov narxi: ${cashPrice} ${currency}/${unit}. Qancha miqdor kerak?`,
  transferPrice: (productName: string, transferPrice: number | string, currency = 'USD', unit = 'kg') =>
    `${productName} pul o‘tkazish (o‘tkazma) narxi: ${transferPrice} ${currency}/${unit}. Qancha miqdor kerak?`,
  priceTransferOnly: (productName: string, transferPrice: number | string, currency = 'USD', unit = 'kg') =>
    `${productName} pul o‘tkazish (o‘tkazma) narxi: ${transferPrice} ${currency}/${unit}. Qancha miqdor kerak?`,
  unknownPrice: (_productName?: string) => 'Hozir aniqlashtirib beraman!',
  paymentTerms:
    'To‘lovlar 100% oldindan to‘lov asosida qabul qilinadi. To‘lovni bank orqali pul o‘tkazish yoki naqt amalga oshirishingiz mumkin.',

  // 5. Minimal Buyurtma Miqdori (MOQ)
  moqStandard:
    'Standart mahsulotlarimizda (BLACK, WHITE) minimal buyurtma talabi (MOQ) yo‘q, xohlagan miqdorda xarid qilishingiz mumkin.',
  standardMoq:
    'Standart mahsulotlarimizda (BLACK, WHITE) minimal buyurtma talabi (MOQ) yo‘q, xohlagan miqdorda xarid qilishingiz mumkin.',
  moqMixColor:
    'Rangli mahsulotlar (MIX COLOR, rangli buyurtmalar) uchun minimal buyurtma miqdori (MOQ) kamida 100 kg etib belgilangan.',
  colorMoq:
    'Rangli mahsulotlar (MIX COLOR, rangli buyurtmalar) uchun minimal buyurtma miqdori (MOQ) kamida 100 kg etib belgilangan.',

  // 6. Namunalar va Kataloglar
  sample: 'Ha, bizda namunalar bepul. Manzilizni aytsez taxidan chiqarib yuboramiz!',
  sampleFree: 'Ha, bizda namunalar bepul. Manzilizni aytsez taxidan chiqarib yuboramiz!',
  sampleFollowUp: 'Namunalarimiz bepul taqdim etiladi. Sizga qaysi manzilga chiqarib yuboraylik?',
  catalogSend: 'Ha hozir yuboraman!',
  catalogHandoff: 'Ha hozir yuboraman!',

  // 7. Manzil, Ish Vaqti va Yetkazib Berish
  factoryAddress:
    'Fabrikamiz manzili: Toshkent viloyati, Angren shahri, Yangiobod ko‘chasi, 2-uy.\nIsh vaqti: Dushanba – Shanba, 08:00 dan 17:30 gacha.',
  locationAngren:
    'Fabrikamiz manzili: Toshkent viloyati, Angren shahri, Yangiobod ko‘chasi, 2-uy.\nIsh vaqti: Dushanba – Shanba, 08:00 dan 17:30 gacha.',
  locationFollowUp:
    'Fabrikamiz Angren shahrida joylashgan. Tashrif buyurmoqchimisiz yoki lokatsiya tashlab beraylikmi?',
  delivery:
    'Mahsulotlar Angren fabrikamizdan o‘zi olib ketish shartida topshiriladi. Shuningdek, Toshkent yoki vodiydagi yuk mashinalari (taksi/fura) orqali jo‘natishda yordam berishimiz mumkin.',
  deliveryTerms:
    'Mahsulotlar Angren fabrikamizdan o‘zi olib ketish shartida topshiriladi. Shuningdek, Toshkent yoki vodiydagi yuk mashinalari (taksi/fura) orqali jo‘natishda yordam berishimiz mumkin.',
  deliveryToday:
    'Omborda tayyor bo‘lsa, bugun taksi yoki yuk mashinasida chiqarib yuborishimiz mumkin. Aniq vaqtini va transportni kelishish uchun hozir menejerimiz sizga yozadi.',
  deliveryFollowUp:
    'Yuqorida ta’kidlaganimizdek, mahsulotlar Angren fabrikamizdan olib ketiladi yoki taksi/fura orqali jo‘natamiz. Sizga qaysi manzilga yetkazib berish kerak?',
  paymentFollowUp:
    'Yuqorida ta’kidlanganidek, to‘lov 100% oldindan to‘lov asosida qabul qilinadi. Sizga qaysi to‘lov usuli (o‘tkazma yoki naqd) ma’qulroq?',
  workingHours:
    'Bizning ish vaqtimiz: Dushanba – Shanba kunlari soat 08:00 dan 17:30 gacha. Yakshanba — dam olish kuni.',

  // 8. Sifat, Kafolat va Tarkib
  warranty: 'Mahsulotlarimizga 2 yil kafolat beriladi.',
  certificates:
    'Ha, barcha mahsulotlarimiz xalqaro sifat standartlariga (ISO, muvofiqlik sertifikatlari) to‘liq javob beradi va sertifikatlangan.',
  composition:
    'Iplarimiz yuqori sifatli poliester, poliamid va spandeks tolalari asosida O‘zbekistonda ishlab chiqariladi.',

  // 9. Chegirmalar va Muzokaralar
  discount: 'Agar katta obyomdan olsangiz iloji bor!',
  discountGeneral: 'Agar katta obyomdan olsangiz iloji bor!',
  bulkOrderHandoff: 'Har bir tavardan har xil hisoblanadi, manager bilan bog‘lanib beramiz.',
  largeVolumeHandoff: 'Har bir tavardan har xil hisoblanadi, manager bilan bog‘lanib beramiz.',

  // 10. Shikoyatlar va E’tirozlar
  complaint:
    'Kechirasiz, mahsulot sifati bo‘yicha muammo yuzaga kelganidan afsusdamiz. Iltimos, muammoli mahsulotning partiya raqami, rasm yoki videosini yuboring. Bosh sifat nazoratchimiz va menejerimiz zudlik bilan ko‘rib chiqadi.',
  returnPolicy:
    'Agar mahsulotda ishlab chiqarish nuqsoni aniqlansa, mutaxassislarimiz xulosasiga ko‘ra to‘liq almashtirib beriladi yoki mablag‘ingiz qaytariladi.',
  returnExchange:
    'Agar mahsulotda ishlab chiqarish nuqsoni aniqlansa, mutaxassislarimiz xulosasiga ko‘ra to‘liq almashtirib beriladi yoki mablag‘ingiz qaytariladi.',

  // 11. Lead Capture Ack
  leadOrderAck: (product: string, quantity: string) =>
    `${product} bo‘yicha ${quantity} buyurtmangiz qabul qilindi. Tez orada menejerimiz shartnoma va yetkazib berish tafsilotlarini rasmiylashtirish uchun bog‘lanadi.`,
};
