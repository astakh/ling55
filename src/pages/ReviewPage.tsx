import React, { useState } from 'react';
import { EvaluationResponse, EvaluatedWord, SuggestedWord } from '../types';
import { apiRequest } from '../api/client';
import { ReportModal } from '../components/ReportModal';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  ArrowRight,
  Flag,
  Sparkles,
} from 'lucide-react';

interface ReviewPageProps {
  evaluation: EvaluationResponse;
  onNext: () => void;
}

export const ReviewPage: React.FC<ReviewPageProps> = ({
  evaluation,
  onNext,
}) => {
  const [showSpoiler, setShowSpoiler] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedWord[]>(evaluation.suggestions);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Surface form highlighting helper
  const renderSentenceWithHighlights = () => {
    const sentence = evaluation.target_sentence;
    // Map words by surface_form
    const words = evaluation.words;

    // Build regex to match surface forms
    const patterns = words
      .map(w => w.surface_form)
      .filter(Boolean)
      .sort((a, b) => b!.length - a!.length);

    if (patterns.length === 0) {
      return <span>{sentence}</span>;
    }

    // Split sentence
    const regex = new RegExp(`(${patterns.map(p => escapeRegExp(p!)).join('|')})`, 'gi');
    const parts = sentence.split(regex);

    return parts.map((part, idx) => {
      const matchedWord = words.find(
        w => w.surface_form && w.surface_form.toLowerCase() === part.toLowerCase()
      );

      if (!matchedWord) {
        return <span key={idx}>{part}</span>;
      }

      let colorClasses = 'bg-rose-100 text-rose-800 border-rose-300';
      if (matchedWord.result === 'correct') {
        colorClasses = 'bg-emerald-100 text-emerald-800 border-emerald-300';
      } else if (matchedWord.result === 'typo') {
        colorClasses = 'bg-amber-100 text-amber-800 border-amber-300';
      }

      return (
        <span
          key={idx}
          className={`inline-block px-1.5 py-0.5 rounded-md font-bold border ${colorClasses} mx-0.5`}
        >
          {part}
        </span>
      );
    });
  };

  const handleSuggestionAction = async (wordId: string, action: 'add' | 'ignore') => {
    setActionLoading(prev => ({ ...prev, [wordId]: true }));
    try {
      await apiRequest(`/lesson/exercises/${evaluation.exercise_id}/suggestions/${wordId}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });

      setSuggestions(prev =>
        prev.map(s => (s.word_id === wordId ? { ...s, state: action === 'add' ? 'added' : 'ignored' } : s))
      );
    } catch (err: any) {
      alert(err.message || 'Ошибка обработки подсказки');
    } finally {
      setActionLoading(prev => ({ ...prev, [wordId]: false }));
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between py-6 max-w-[640px] mx-auto px-4 animate-fade-in pb-12">
      <div className="space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Разбор результата
          </span>
          <button
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition"
          >
            <Flag className="w-3.5 h-3.5" />
            <span>Пожаловаться</span>
          </button>
        </div>

        {/* Highlighted sentence */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="text-xl sm:text-2xl font-black text-slate-900 leading-snug">
            {renderSentenceWithHighlights()}
          </div>

          {/* User's typed translation */}
          {evaluation.user_translation && (
            <div className="pt-2 border-t border-slate-100 text-xs text-slate-500">
              <span className="font-semibold text-slate-400 block mb-0.5">Ваш перевод:</span>
              <span className="italic text-slate-700 font-medium">"{evaluation.user_translation}"</span>
            </div>
          )}

          {/* Reference translation spoiler */}
          <div className="pt-2 border-t border-slate-100">
            <button
              onClick={() => setShowSpoiler(!showSpoiler)}
              className="flex items-center justify-between w-full text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              <span>{showSpoiler ? 'Скрыть эталонный перевод' : 'Показать эталонный перевод'}</span>
              {showSpoiler ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showSpoiler && (
              <p className="mt-2 text-sm text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100 font-medium animate-fade-in">
                {evaluation.reference_translation}
              </p>
            )}
          </div>
        </div>

        {/* Target Words Breakdown */}
        <div className="space-y-3">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
            Оценка целевых слов
          </div>

          <div className="space-y-2.5">
            {evaluation.words.map(w => (
              <div
                key={w.word_id}
                className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-900">{w.lemma}</span>
                    <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">
                      {w.pos}
                    </span>
                    {w.surface_form && w.surface_form.toLowerCase() !== w.lemma.toLowerCase() && (
                      <span className="text-xs text-slate-400">
                        (в тексте: {w.surface_form})
                      </span>
                    )}
                  </div>

                  {w.result === 'correct' && (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                      <CheckCircle className="w-3.5 h-3.5" /> Верно
                    </span>
                  )}
                  {w.result === 'typo' && (
                    <span className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg">
                      <AlertTriangle className="w-3.5 h-3.5" /> Опечатка
                    </span>
                  )}
                  {w.result === 'incorrect' && (
                    <span className="flex items-center gap-1 text-xs font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg">
                      <XCircle className="w-3.5 h-3.5" /> Неверно
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                  <div>
                    Перевод: <strong className="text-slate-800">{w.translations.join(', ')}</strong>
                  </div>
                  {w.user_fragment ? (
                    <div>
                      В вашем ответе: <span className="font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">«{w.user_fragment}»</span>
                    </div>
                  ) : (
                    <div className="text-slate-400 italic">Слово не переведено</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Suggested Words Section */}
        {suggestions.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>Новые слова из предложения</span>
            </div>

            <div className="space-y-2">
              {suggestions.map(s => {
                const isLoading = actionLoading[s.word_id];
                const state = s.state || 'suggested';

                return (
                  <div
                    key={s.word_id}
                    className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{s.lemma}</span>
                        <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">
                          {s.pos}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {s.translations.join(', ')}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {state === 'added' ? (
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                          Добавлено
                        </span>
                      ) : state === 'ignored' ? (
                        <span className="text-xs font-medium text-slate-400 px-2.5 py-1">
                          Скрыто
                        </span>
                      ) : (
                        <>
                          <button
                            disabled={isLoading}
                            onClick={() => handleSuggestionAction(s.word_id, 'add')}
                            className="p-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center gap-1 transition disabled:opacity-50"
                            title="Добавить в обучение"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Учить</span>
                          </button>
                          <button
                            disabled={isLoading}
                            onClick={() => handleSuggestionAction(s.word_id, 'ignore')}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition disabled:opacity-50"
                            title="Не предлагать"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Next button */}
      <div className="pt-6">
        <button
          onClick={onNext}
          className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-200 transition active:scale-[0.99] flex items-center justify-center gap-2 text-base"
        >
          <span>Далее</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <ReportModal
        exerciseId={evaluation.exercise_id}
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
      />
    </div>
  );
};

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
