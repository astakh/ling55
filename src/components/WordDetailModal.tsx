import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { WordDetailResponse } from '../types';
import { apiRequest } from '../api/client';

interface WordDetailModalProps {
  wordId: string;
  isOpen: boolean;
  onClose: () => void;
  onStatusChanged?: () => void;
}

export const WordDetailModal: React.FC<WordDetailModalProps> = ({
  wordId,
  isOpen,
  onClose,
  onStatusChanged,
}) => {
  const [data, setData] = useState<WordDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !wordId) return;

    setIsLoading(true);
    setError(null);

    apiRequest<WordDetailResponse>(`/vocabulary/word/${wordId}`)
      .then(res => setData(res))
      .catch(err => setError(err.message || 'Ошибка загрузки карточки слова'))
      .finally(() => setIsLoading(false));
  }, [isOpen, wordId]);

  if (!isOpen) return null;

  const handleStatusChange = async (newStatus: 'active' | 'ignored') => {
    setIsUpdating(true);
    try {
      await apiRequest(`/vocabulary/word/${wordId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      // Refresh
      const updated = await apiRequest<WordDetailResponse>(`/vocabulary/word/${wordId}`);
      setData(updated);
      onStatusChanged?.();
    } catch (err: any) {
      alert(err.message || 'Ошибка обновления статуса');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                {data ? data.lemma : 'Загрузка...'}
              </h2>
              {data?.pos && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                  {data.pos}
                </span>
              )}
              {data?.level && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700">
                  {data.level}
                </span>
              )}
            </div>
            <p className="text-base text-slate-600 font-medium">
              {data?.translations.join(', ')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Загрузка информации...</div>
          ) : error ? (
            <div className="p-4 bg-rose-50 text-rose-700 rounded-xl text-sm">{error}</div>
          ) : data ? (
            <>
              {/* SRS Stage progress */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Статус: <strong className="text-slate-800 uppercase tracking-wider">{data.status}</strong></span>
                  {data.status === 'active' && data.due_in_lessons !== null && (
                    <span className="flex items-center gap-1 text-indigo-600 font-semibold">
                      <Clock className="w-3.5 h-3.5" />
                      Повтор через {data.due_in_lessons} {data.due_in_lessons === 1 ? 'урок' : 'урока'}
                    </span>
                  )}
                  {data.status === 'mastered' && (
                    <span className="text-emerald-600 font-semibold">Выучено</span>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-600">
                    <span>Стадия интервального повторения</span>
                    <span>{data.stage} / 6</span>
                  </div>
                  <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex gap-0.5">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div
                        key={i}
                        className={`flex-1 h-full transition-all ${
                          i <= data.stage ? 'bg-indigo-600' : 'bg-transparent'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  {data.status === 'active' ? (
                    <button
                      onClick={() => handleStatusChange('ignored')}
                      disabled={isUpdating}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline disabled:opacity-50"
                    >
                      Не изучать (исключить)
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStatusChange('active')}
                      disabled={isUpdating}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline disabled:opacity-50"
                    >
                      Вернуть в изучение (сбросить на этап 0)
                    </button>
                  )}
                </div>
              </div>

              {/* Context History */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  История контекстов в уроках ({data.history.length})
                </h4>

                {data.history.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    Слово пока не встречалось в завершенных упражнениях.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.history.map((h, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl border border-slate-100 bg-white hover:border-slate-200 transition space-y-2 shadow-xs"
                      >
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>{h.date ? new Date(h.date).toLocaleDateString('ru-RU') : ''}</span>
                          {h.result === 'correct' && (
                            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                              <CheckCircle className="w-3.5 h-3.5" /> Верно
                            </span>
                          )}
                          {h.result === 'typo' && (
                            <span className="flex items-center gap-1 text-amber-600 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5" /> Опечатка
                            </span>
                          )}
                          {h.result === 'incorrect' && (
                            <span className="flex items-center gap-1 text-rose-600 font-semibold">
                              <XCircle className="w-3.5 h-3.5" /> Ошибка
                            </span>
                          )}
                          {!h.is_target && (
                            <span className="text-slate-500 font-medium">Из подсказок</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-800 leading-snug">
                          {h.target_sentence}
                        </p>
                        <p className="text-xs text-slate-500">
                          {h.reference_translation}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
