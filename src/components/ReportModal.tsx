import React, { useState } from 'react';
import { Flag, X, Check } from 'lucide-react';
import { apiRequest } from '../api/client';

interface ReportModalProps {
  exerciseId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  exerciseId,
  isOpen,
  onClose,
}) => {
  const [reason, setReason] = useState<'bad_sentence' | 'wrong_translation' | 'grammar_error' | 'other'>('wrong_translation');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await apiRequest(`/lesson/exercises/${exerciseId}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason, comment }),
      });
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setComment('');
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Не удалось отправить жалобу');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold">
            <Flag className="w-5 h-5 text-indigo-600" />
            <span>Сообщить об ошибке</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSuccess ? (
          <div className="py-8 text-center text-emerald-600 flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Check className="w-6 h-6" />
            </div>
            <p className="font-semibold text-slate-900">Спасибо за обратную связь!</p>
            <p className="text-xs text-slate-500">Жалоба передана методистам.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Причина жалобы
              </label>
              <div className="space-y-2">
                {[
                  { value: 'wrong_translation', label: 'Ошибка в переводе или оценке' },
                  { value: 'bad_sentence', label: 'Неестественное предложение' },
                  { value: 'grammar_error', label: 'Грамматическая или пунктуационная ошибка' },
                  { value: 'other', label: 'Другое' },
                ].map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-sm cursor-pointer transition ${
                      reason === opt.value
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-medium'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={opt.value}
                      checked={reason === opt.value}
                      onChange={() => setReason(opt.value as any)}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Комментарий (необязательно)
              </label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Что именно показалось неточным или некорректным?"
                className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="text-right text-xs text-slate-400 mt-1">
                {comment.length} / 500
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-100">
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition text-sm"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2.5 px-4 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition text-sm shadow-sm"
              >
                {isSubmitting ? 'Отправка...' : 'Отправить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
