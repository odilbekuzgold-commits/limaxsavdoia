# Walkthrough: Dashboard Suhbatlar Ko'ruvchisi va Asosiy Panel Ajratilishi

## Amalga oshirilgan ishlar

### 1. Suhbatlar (`/dashboard/conversations`) sahifasini to'liq interaktiv chat ko'ruvchisiga aylantirish
- **Oldingi holat**: Faqat tushunarsiz mijoz ID raqamlari (UUID) va oddiy jadval ko'rinib, suhbatni ochish va xabarlarni o'qish imkoniyati yo'q edi.
- **Yangi imkoniyatlar**:
  - **Mijoz ma'lumotlari**: UUID o'rniga mijozning ismi (yoki `@username`), telefon raqami, oxirgi xabari snippet ko'rinishida chiqarildi.
  - **Interaktiv Chat Drawer / Modal**: Har qanday qatorni yoki **"💬 Suhbatni ochish"** tugmasini bosganda o'ng tomondan to'liq suhbat tarixi ochiladi.
  - **Telegram xabar formatlash**:
    - Chap tomonda mijozning xabarlari (vaqti bilan).
    - O'ng tomonda **🤖 Limax AI Menejer** javoblari (yashil rangda, vaqti va `✓✓` belgilari bilan).
  - **Qidiruv va Filtrlar**:
    - Mijoz ismi, telefoni yoki xabar matni bo'yicha tezkor qidiruv.
    - `Barchasi`, `🤖 AI faol`, `⏳ Menejer kutilmoqda` holatlari bo'yicha filtrlar va `Yangilash` tugmasi.

---

### 2. Asosiy panel (`/dashboard`) va AI tahlil (`/dashboard/analytics`) sahifalarini bir-biridan to'liq ajratish
- **Oldingi muammo**: Bosh sahifa va AI tahlil sahifasi bitta kodni (`DashboardClientContainer`) chaqirib, ikkalasida ham bir xil diagrammalar ko'rinib qolgan edi.
- **Yechim va Farqlanish**:
  - **Asosiy panel (`/dashboard` - Boshqaruv markazi)**:
    - **Tizim va Integratsiyalar salomatligi**: Telegram Bot (`@Limax_Manager_AI_1_bot`), Google Sheets, AI Engine v2.0, PostgreSQL bazasi faollik holati.
    - **Operatsion KPI ko'rsatkichlari**: Faol suhbatlar soni, Jami mijozlar bazasi, Ro'yxatdagi leadlar, Mahsulotlar soni.
    - **Tezkor amallar (Quick Action Hub)**: Suhbatlarni ochish, AI tahlilga o'tish, Ombor qoldiqlarini ko'rish, Bilimlar bazasini boshqarish.
    - **Jonli 2 ustunli blok**: So'nggi kelgan Telegram muloqotlari (oxirgi xabar bilan) va Yangi kelgan leadlar (HOT/WARM/COLD harorat belgilari bilan).
  - **AI tahlil (`/dashboard/analytics` - Maxsus tahliliy sahifa)**:
    - Pre-sales voronkasi, Leadlar sifati va AI ishlash statistikasi doiraviy (donut) diagrammalari.
    - Eng ko'p so'ralgan ip mahsulotlari (Top Products).
    - Top menejerlar ko'rsatkichlari va reytingi.
    - Chuqur 8 ta KPI paneli (Javob tezligi, namunalar, tijoriy takliflar, uchrashuvlar va konversiya).

---

## Server holati va Tekshiruv

1. **API va Dashboard build**:
   - `pnpm --filter @limax/api build` — 100% muvaffaqiyatli (`tsc` xatosiz).
   - `pnpm --filter @limax/dashboard build` — 100% muvaffaqiyatli (`next build` xatosiz).
2. **VPS Deploy (`93.115.20.148`)**:
   - `git pull origin main` — kod to'liq yangilandi.
   - `systemctl restart limax-ai-api.service` — faol (`active`).
   - `systemctl restart limax-ai-dashboard.service` — faol (`active`).
   - Telegram Polling: `@Limax_Manager_AI_1_bot` orqali muloqotlar qabul qilinmoqda.
