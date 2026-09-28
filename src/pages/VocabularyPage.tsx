import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { VocabularyItem } from '../types';
import { WordDetailModal } from '../components/WordDetailModal';
import { Search, BookOpen, Clock, ChevronRight, X, RotateCcw } from 'lucide-react';

export const VocabularyPage: React.FC = () => {
  const { activeProfile } = useAuth();
  const [tab, setTab] = useState<'all' | 'active' | 'mastered' | 'ignored'>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);

  const loadWords = async () => {
    if (!activeProfile) return;
    setIsLoading(true);
    try {
      const statusParam = tab === 'all' ? '' : `&status=${tab}`;
      const qParam = search ? `&q=${encodeURIComponent(search)}` : '';
      const res = await apiRequest<{
        items: VocabularyItem[];
        page: number;
        total_pages: number;
        total: number;
      }>(`/vocabulary/list?language_profile_id=${activeProfile.id}&page=${page}&page_size=20${statusParam}${qParam}`);

      setItems(res.items || []);
      setTotalPages(res.total_pages || 1);
      setTotalCount(res.total || 0);
    } catch (err) {
      console.error('Error loading words:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWords();
  }, [activeProfile?.id, tab, search, page]);

  const handleQuickStatusChange = async (e: React.MouseEvent, wordId: string, targetStatus: 'active' | 'ignored') => {
    e.stopPropagation();
    try {
      await apiRequest(`/vocabulary/word/${wordId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          language_profile_id: activeProfile?.id,
          status: targetStatus,
        }),
      });
      loadWords();
    } catch (err: any) {
      alert(err.message || 'Ошибка обновления статуса');
    }
  };

  return (
    <div className="space-y-5 pb-24 animate-fade-in">
      <div className="pt-2">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Мой словарь
        </h1>
        <p className="text-xs text-slate-500">
          Слова и стадии интервального повторения
        </p>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
        {(['all', 'active', 'mastered', 'ignored'] as const).map(t => {
          const labels = {
            all: 'Все',
            active: 'В процессе',
            mastered: 'Выучено',
            ignored: 'Исключено',
          };
          return (
            <button
              key={t}
              onClick={() => { setTab(t); setPage(1); }}
              className={`flex-1 py-2 text-center rounded-lg transition ${
                tab === t
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Поиск по слову или переводу..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Word Cards List */}
      {isLoading ? (
        <div className="py-20 text-center text-slate-400 text-xs">
          Загрузка словаря...
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-slate-400 space-y-2 bg-white rounded-2xl border border-slate-200 p-8">
          <BookOpen className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">Слова не найдены</p>
          <p className="text-xs text-slate-400">
            {search ? 'Попробуйте изменить поисковый запрос' : 'В этом разделе пока нет добавленных слов'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="text-xs text-slate-400 px-1 font-medium">
            Всего слов: {totalCount}
          </div>

          {items.map(item => (
            <div
              key={item.word_id}
              onClick={() => setSelectedWordId(item.word_id)}
              className="p-4 bg-white border border-slate-200 hover:border-slate-300 rounded-xl shadow-2xs cursor-pointer transition flex items-center justify-between group"
            >
              <div className="space-y-1 flex-1 pr-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-base">{item.lemma}</span>
                  <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                    {item.pos}
                  </span>
                  {item.level && (
                    <span className="text-[11px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-medium">
                      {item.level}
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-500 font-medium">
                  {item.translations.join(', ')}
                </div>

                {/* Stage bar */}
                {item.status === 'active' && (
                  <div className="flex items-center gap-3 pt-1 text-xs">
                    <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden flex gap-0.5">
                      {[1, 2, 3, 4, 5, 6].map(st => (
                        <div
                          key={st}
                          className={`flex-1 h-full ${
                            st <= item.stage ? 'bg-indigo-600' : 'bg-transparent'
                          }`}
                        />
                      ))}
                    </div>
                    {item.due_in_lessons !== null && (
                      <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                        <Clock className="w-3 h-3 text-slate-400" />
                        через {item.due_in_lessons} {item.due_in_lessons === 1 ? 'урок' : 'ур.'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Action button */}
              <div className="flex items-center gap-2">
                {item.status === 'active' ? (
                  <button
                    onClick={(e) => handleQuickStatusChange(e, item.word_id, 'ignored')}
                    className="p-1.5 text-xs text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    title="Не изучать"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => handleQuickStatusChange(e, item.word_id, 'active')}
                    className="p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition flex items-center gap-1"
                    title="Вернуть в изучение"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition" />
              </div>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 pt-4 text-xs font-semibold">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(p - 1, 1))}
                className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40"
              >
                Назад
              </button>
              <span className="text-slate-500">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40"
              >
                Вперед
              </button>
            </div>
          )}
        </div>
      )}

      {selectedWordId && (
        <WordDetailModal
          wordId={selectedWordId}
          isOpen={Boolean(selectedWordId)}
          onClose={() => setSelectedWordId(null)}
          onStatusChanged={loadWords}
        />
      )}
    </div>
  );
};
