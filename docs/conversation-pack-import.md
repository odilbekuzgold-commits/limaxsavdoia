# LImax Conversation Pack V2 — import yo‘riqnomasi

## Fayllar

- `LImax_Conversation_Intelligence_Pack_V2_CORRECTED.md` — odam o‘qiydigan asosiy hujjat.
- `limax_conversation_behavior_v2.json` — system/orchestrator behavior konfiguratsiyasi.
- `limax_knowledge_import_v2.json` — Knowledge API formatiga mos import yozuvlari.
- `limax_conversation_regression_v2.json` — staging regression test dataset'i.

## Xavfsiz import tartibi

1. Behavior JSON'ni schema validation'dan o‘tkazing; uni oddiy RAG fakt hujjati sifatida import qilmang.
2. Knowledge import yozuvlarini `/api/v1/knowledge` orqali kiriting. Ular ataylab `DRAFT` holatida.
3. Har bir knowledge item'ni menejer ko‘rib, keraklisini alohida `APPROVED` qilsin.
4. Embedding/chunk generation faqat `APPROVED` itemlar uchun bajarilsin.
5. Regression dataset'ni mock va real provider staging rejimida bajaring.
6. Barcha testlar o‘tmaguncha production botga yoqmang.

## Muhim cheklov

Bu paket biznes narxi, stock, MOQ, muddat, delivery, payment, discount yoki texnik specification yaratmaydi. Ular structured database yoki alohida `APPROVED` biznes knowledge orqali boshqariladi.
