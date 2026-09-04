import { MASTER_RESPONSES_UZ } from '../templates/master-responses.js';

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
    unknownPrice: (productName) => MASTER_RESPONSES_UZ.unknownPrice(productName),
    unknownStock: (productName) =>
      productName ? MASTER_RESPONSES_UZ.stockGeneralAvailable(productName) : 'Ha, mahsulot omborda mavjud.',
    askProductOrCode: () => MASTER_RESPONSES_UZ.unspecifiedProductClarify,
    askQuantity: (productName) =>
      productName ? `${productName} bo‘yicha qancha kerak bo’ladi?` : 'Qancha kerak bo’ladi?',
    complaintApology: () => MASTER_RESPONSES_UZ.complaint,
    requestEvidence: () =>
      'Iltimos, muammoli mahsulotning partiya raqami, rasm yoki videosini yuboring. Menejerimiz ko‘rib chiqadi.',
    sampleUnverified: () => MASTER_RESPONSES_UZ.catalogHandoff,
    managerHandoff: () => MASTER_RESPONSES_UZ.managerHandoff,
    securityBlocked: () => MASTER_RESPONSES_UZ.securityBlocked,
    identityResponse: () => MASTER_RESPONSES_UZ.identity,
    actionNeutralFallback: () => 'Hozir aniqlashtirib beraman!',
  },
  'uz-Cyrl': {
    unknownPrice: (_productName) => 'Ҳозир аниқлаштириб бераман!',
    unknownStock: (productName) =>
      productName ? `Ҳа, ${productName} бор.` : 'Ҳа, маҳсулот омборда бор.',
    askProductOrCode: () => 'Ҳозир аниқлаштириб бераман!',
    askQuantity: (productName) =>
      productName ? `${productName} бўйича қанча керак бўлади?` : 'Қанча керак бўлади?',
    complaintApology: () =>
      'Кечирасиз, маҳсулот сифати бўйича муаммо юзага келганидан афсусдамиз. Илтимос, муаммоли маҳсулотнинг расм ёки видеосини юборинг. Бош сифат назоратчимиз ва менежеримиз кўриб чиқади.',
    requestEvidence: () =>
      'Илтимос, муаммоли маҳсулотнинг расм ёки видеосини юборинг.',
    sampleUnverified: () => 'Ҳа ҳозир юбораман!',
    managerHandoff: () => 'Ҳоп бўлади. Менежерга айтаман сизга ёзади.',
    securityBlocked: () => 'Узур, бу масала бўйича маълумот беролмайман.',
    identityResponse: () => 'Нега бундай деяпсиз?',
    actionNeutralFallback: () => 'Ҳозир аниқлаштириб бераман!',
  },
  ru: {
    unknownPrice: (_productName) => 'Сейчас уточню информацию!',
    unknownStock: (productName) =>
      productName ? `Да, ${productName} есть в наличии.` : 'Да, товар в наличии на складе.',
    askProductOrCode: () => 'Сейчас уточню информацию!',
    askQuantity: (productName) =>
      productName ? `Какое количество ${productName} вам необходимо?` : 'Какое количество вам необходимо?',
    complaintApology: () =>
      'Приносим извинения за неудобства. Пожалуйста, отправьте фото или видео дефекта. Наш менеджер свяжется с вами.',
    requestEvidence: () =>
      'Пожалуйста, отправьте фото или видео дефекта.',
    sampleUnverified: () => 'Да, сейчас отправлю!',
    managerHandoff: () => 'Хорошо. Я передам менеджеру, он напишет вам.',
    securityBlocked: () => 'Извините, по данному вопросу не могу предоставить информацию.',
    identityResponse: () => 'Почему вы так говорите?',
    actionNeutralFallback: () => 'Сейчас уточню информацию!',
  },
};

export function getTemplates(lang?: string): LocalizedTemplates {
  if (lang === 'ru') return TEMPLATES['ru'];
  if (lang === 'uz-Cyrl') return TEMPLATES['uz-Cyrl'];
  return TEMPLATES['uz-Latn'];
}

export function getLocalizedTemplate(lang: string, key: TemplateKey, arg?: string): string {
  const t = getTemplates(lang);
  const fn = t[key] as any;
  if (typeof fn === 'function') {
    return fn(arg);
  }
  return '';
}
