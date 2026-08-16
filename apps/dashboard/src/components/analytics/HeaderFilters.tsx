'use client';

export interface FilterState {
  lang: 'uz' | 'ru';
  managerId: string;
  dateRange: 'today' | '7d' | '30d' | 'month' | 'all';
}

interface HeaderFiltersProps {
  filters: FilterState;
  managerOptions?: Array<{ id: string; name: string }>;
  onChange: (newFilters: FilterState) => void;
  onRefresh: () => void;
  loading?: boolean;
}

export function HeaderFilters({
  filters,
  managerOptions = [],
  onChange,
  onRefresh,
  loading,
}: HeaderFiltersProps) {
  const isRu = filters.lang === 'ru';

  return (
    <div className="header-bar">
      <div className="header-title">
        <h1>{isRu ? 'Аналитика Pre-sales Dashboard' : 'Pre-sales Analytics Dashboard'}</h1>
        <p>
          {isRu
            ? 'Показатели эффективности продаж и работы ИИ-менеджера LImax'
            : 'LImax Yarn sotuv jarayonlari va AI menejeri samaradorligi ko‘rsatkichlari'}
        </p>
      </div>

      <div className="filter-group">
        <select
          aria-label="Tili"
          className="filter-select"
          value={filters.lang}
          onChange={(e) => onChange({ ...filters, lang: e.target.value as 'uz' | 'ru' })}
        >
          <option value="uz">🇺🇿 O‘zbekcha (UZ)</option>
          <option value="ru">🇷🇺 Русский (RU)</option>
        </select>

        <select
          aria-label="Menejer"
          className="filter-select"
          value={filters.managerId}
          onChange={(e) => onChange({ ...filters, managerId: e.target.value })}
        >
          <option value="all">{isRu ? 'Все менеджеры' : 'Barcha menejerlar'}</option>
          {managerOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Sana oralig‘i"
          className="filter-select"
          value={filters.dateRange}
          onChange={(e) => onChange({ ...filters, dateRange: e.target.value as FilterState['dateRange'] })}
        >
          <option value="today">{isRu ? 'Сегодня' : 'Bugun'}</option>
          <option value="7d">{isRu ? 'Последние 7 дней' : 'Oxirgi 7 kun'}</option>
          <option value="30d">{isRu ? 'Последние 30 дней' : 'Oxirgi 30 kun'}</option>
          <option value="month">{isRu ? 'Текущий месяц' : 'Shu oy'}</option>
          <option value="all">{isRu ? 'За все время' : 'Barcha davr'}</option>
        </select>

        <button className="btn-refresh" onClick={onRefresh} disabled={loading} type="button">
          <span
            style={{
              display: 'inline-block',
              transform: loading ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.4s',
            }}
          >
            ↻
          </span>
          {loading ? (isRu ? 'Обновление...' : 'Yangilanmoqda...') : isRu ? 'Обновить' : 'Yangilash'}
        </button>
      </div>
    </div>
  );
}
