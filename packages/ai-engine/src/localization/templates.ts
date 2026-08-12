import type { SupportedLanguage } from '@limax/shared';

export type TemplateKey =
  | 'unknownPrice'
  | 'unknownStock'
  | 'askProductOrCode'
  | 'askQuantity'
  | 'complaintApology'
  | 'requestEvidence'
  | 'sampleUnverified'
  | 'managerHandoff'
  | 'securityBlocked'
  | 'identityResponse'
  | 'actionNeutralFallback';

export interface LocalizedTemplates {
  unknownPrice: (productName?: string) => string;
  unknownStock: (productName?: string) => string;
  askProductOrCode: () => string;
  askQuantity: (productName?: string) => string;
  complaintApology: () => string;
  requestEvidence: () => string;
  sampleUnverified: () => string;
  managerHandoff: () => string;
  securityBlocked: () => string;
  identityResponse: () => string;
  actionNeutralFallback: () => string;
}

export const TEMPLATES: Record<'uz-Latn' | 'uz-Cyrl' | 'ru', LocalizedTemplates> = {
  'uz-Latn': {
    unknownPrice: (productName) =>
      productName
        ? `Kechirasiz, ${productName} boʻyicha amaldagi narx tasdiqlanmagan. Qancha miqdor kerak edi?`
        : 'Kechirasiz, ushbu mahsulot boʻyicha amaldagi narx tasdiqlanmagan. Qancha miqdor kerak edi?',
    unknownStock: (productName) =>
      productName
        ? `Kechirasiz, ${productName} hozirda omborda mavjud emas yoki holati nomaʼlum. Qancha miqdor kerak edi?`
        : 'Kechirasiz, amaldagi qoldiq tasdiqlanmagan. Qancha miqdor kerak edi?',
    askProductOrCode: () =>
      'Iltimos, qaysi mahsulot yoki ip kodi (masalan, 30/70 oq) boʻyicha narx kerakligini koʻrsating.',
    askQuantity: (productName) =>
      productName
        ? `${productName} boʻyicha qancha miqdor (masalan, necha kg yoki tonna) kerak edi?`
        : 'Sizga qancha miqdor kerak edi?',
    complaintApology: () =>
      'Kechirasiz, mahsulot sifati boʻyicha muammo yuzaga kelganidan afsusdamiz.',
    requestEvidence: () =>
      'Iltimos, muammoli mahsulotning rasm yoki videosini yuboring. Menejerimiz tez orada koʻrib chiqadi.',
    sampleUnverified: () =>
      'Kechirasiz, namunalar va kataloglar mavjudligi menejerimiz tomonidan tasdiqlanadi. Tez orada bogʻlanamiz.',
    managerHandoff: () =>
      'Murojaatingiz menejerga oshirildi. Tez orada siz bilan bogʻlanamiz.',
    securityBlocked: () =>
      'Kechirasiz, ushbu savol boʻyicha javob bera olmayman. Menejerimiz tez orada bogʻlanadi.',
    identityResponse: () =>
      'Men LImax AI yordamchisiman. Sizga B2B mahsulotlarimiz va zakazlar boʻyicha yordam beraman.',
    actionNeutralFallback: () =>
      'Maʼlumot menejerimiz tomonidan aniqlashtirilmoqda va tez orada taqdim etiladi.',
  },
  'uz-Cyrl': {
    unknownPrice: (productName) =>
      productName
        ? `Кечираsiz, ${productName} бўйича амалдаги нарх тасдиқланмаган. Қанча миқдор керак эди?`
        : 'Кечирасиз, ушбу маҳсулот бўйича амалдаги нарх тасдиқланмаган. Қанча миқдор керак эди?',
    unknownStock: (productName) =>
      productName
        ? `Кечирасиз, ${productName} ҳозирда омборда мавжуд эмас ёки ҳолати номаълум. Қанча миқдор керак эди?`
        : 'Кечирасиз, амалдаги қолдиқ тасдиқланмаган. Қанча миқдор керак эди?',
    askProductOrCode: () =>
      'Илтимос, қайси маҳсулот ёки ип коди (масалан, 30/70 оқ) бўйича нарх кераклигини кўрсатинг.',
    askQuantity: (productName) =>
      productName
        ? `${productName} бўйича қанча миқдор (масалан, неча кг ёки тонна) керак эди?`
        : 'Сизга қанча миқдор керак эди?',
    complaintApology: () =>
      'Кечирасиз, маҳсулот сифати бўйича муаммо юзага келганидан афсусдамиз.',
    requestEvidence: () =>
      'Илтимос, муаммоли маҳсулотнинг расм ёки видеосини юборинг. Менежеримиз тез орада кўриб чиқади.',
    sampleUnverified: () =>
      'Кечирасиз, намуналар ва каталоглар мавжудлиги менежеримиз томонидан тасдиқланади. Тез орада боғланамиз.',
    managerHandoff: () =>
      'Мурожаатингиз менежорга оширилди. Тез орада сиз билан боғланамиз.',
    securityBlocked: () =>
      'Кечирасиз, ушбу савол бўйича жавоб бера олмайман. Менежеримиз тез орада боғланади.',
    identityResponse: () =>
      'Ман LImax AI ёрдамчисиман. Сизга B2B маҳсулотларимиз ва заказлар бўйича ёрдам бераман.',
    actionNeutralFallback: () =>
      'Маълумот менежеримиз томонидан аниқлаштирилмоқда ва тез орада тақдим этилади.',
  },
  ru: {
    unknownPrice: (productName) =>
      productName
        ? `К сожалению, актуальная цена на ${productName} пока не подтверждена. Какое количество вам нужно?`
        : 'К сожалению, актуальная цена на данный товар не подтверждена. Какое количество вам нужно?',
    unknownStock: (productName) =>
      productName
        ? `К сожалению, ${productName} сейчас отсутствует на складе или статус неизвестен. Какое количество вам нужно?`
        : 'К сожалению, актуальный остаток не подтверждён. Какое количество вам нужно?',
    askProductOrCode: () =>
      'Пожалуйста, укажите код товара или название (например, 30/70 белый), чтобы узнать цену.',
    askQuantity: (productName) =>
      productName
        ? `Какое количество ${productName} вам необходимо (в кг или тоннах)?`
        : 'Какое количество вам необходимо?',
    complaintApology: () =>
      'Приносим извинения за возникшие неудобства с качеством продукции.',
    requestEvidence: () =>
      'Пожалуйста, отправьте фото или видео продукции. Наш менеджер свяжется с вами в ближайшее время.',
    sampleUnverified: () =>
      'К сожалению, наличие образцов и каталогов подтверждается менеджером. Мы скоро свяжемся с вами.',
    managerHandoff: () =>
      'Ваше обращение передано менеджеру. Скоро мы с вами свяжемся.',
    securityBlocked: () =>
      'К сожалению, я не могу ответить на этот вопрос. Наш менеджер скоро свяжется с вами.',
    identityResponse: () =>
      'Я AI-ассистент LImax. Помогаю по B2B продукции и заказам пряжи.',
    actionNeutralFallback: () =>
      'Информация уточняется нашим менеджером и будет предоставлена в ближайшее время.',
  },
};

export function getLocalizedTemplate(
  lang: SupportedLanguage | string
): LocalizedTemplates {
  if (lang === 'uz-Cyrl') {
    return TEMPLATES['uz-Cyrl'];
  }
  if (lang === 'ru') {
    return TEMPLATES['ru'];
  }
  // Default to uz-Latn for uz, uz-Latn or unknown
  return TEMPLATES['uz-Latn'];
}
