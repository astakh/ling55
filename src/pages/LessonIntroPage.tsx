import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { LessonPreviewResponse, DueWordPreview, NewWordPreview } from '../types';
import { Sparkles, X, AlertTriangle, ArrowLeft, RefreshCw, BookOpen } from 'lucide-react';

interface LessonIntroPageProps {
  onBack: () => void;
  onLessonStarted: (lessonId: string, firstExerciseId: string, orderIndex: number, sentence: string, total: number) => void;
  onOpenLanguageSettings: () => void;
}

export const LessonIntroPage: React.FC<LessonIntroPageProps> = ({
  onBack,
  onLessonStarted,
  onOpenLanguageSettings,
}) => {
  const { activeProfile } = useAuth();
  const [preview, setPreview] = useState<LessonPreviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [decliningWordId, setDecliningWordId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiRequest<LessonPreviewResponse>('/lesson/preview', {
        method: 'POST',
        body: JSON.stringify({ language_profile_id: activeProfile?.id }),
      });
      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки состава урока');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
  }, [activeProfile?.id]);

  const handleDeclineNewWord = async (wordId: string) => {
    setDecliningWordId(wordId);
    try {
      const updated = await apiRequest<LessonPreviewResponse>('/lesson/new-word/decline', {
        method: 'POST',
        body: JSON.stringify({
          language_profile_id: activeProfile?.id,
          word_id: wordId,
        }),
      });
      setPreview(updated);
    } catch (err: any) {
      alert(err.message || 'Не удалось отклонить слово');
    } finally {
      setDecliningWordId(null);
    }
  };

  const handleStart = async () => {
    if (!preview || !activeProfile) return;

    const wordIds: string[] = [];
    if (preview.due_words) {
      wordIds.push(...preview.due_words.map(w => w.word_id));
    }
    if (preview.new_words) {
      wordIds.push(...preview.new_words.map(w => w.word_id));
    }

    if (wordIds.length === 0) return;

    setIsStarting(true);
    setError(null);

    try {
      const res = await apiRequest<{
        lesson_id: string;
        lesson_number: number;
        exercises_total: number;
        current_exercise: {
          exercise_id: string;
          order_index: number;
          sentence: string;
        };
      }>('/lesson/start', {
        method: 'POST',
        body: JSON.stringify({
          language_profile_id: activeProfile.id,
          word_ids: wordIds,
        }),
      });

      onLessonStarted(
        res.lesson_id,
        res.current_exercise.exercise_id,
        res.current_exercise.order_index,
        res.current_exercise.sentence,
        res.exercises_total
      );
    } catch (err: any) {
      setError(err.message || 'Сервер временно перегружен, попробуйте еще раз');
      setIsStarting(false);
    }
  };

  if (isStarting) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-white text-center animate-fade-in">
        <div className="w-16 h-16 border-4 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin mb-6" />
        <h3 className="text-2xl font-black mb-2 tracking-tight">Готовим урок…</h3>
        <p className="text-sm text-slate-300 max-w-xs leading-relaxed">
          Искусственный интеллект составляет осмысленные предложения на основе выбранных слов.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="py-24 text-center text-slate-400 flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-sm font-medium">Подбираем слова для урока...</span>
      </div>
    );
  }

  if (preview?.state === 'no_words') {
    return (
      <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-4 my-8">
        <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <BookOpen className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">В этом словаре нет новых слов</h3>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          Все доступные слова словаря для вашего уровня уже добавлены в обучение. Выберите другой словарь или повысьте уровень.
        </p>
        <button
          onClick={onOpenLanguageSettings}
          className="py-2.5 px-5 bg-indigo-600 text-white font-semibold rounded-xl text-sm hover:bg-indigo-700 transition"
        >
          Сменить словарь
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      {/* Top navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Назад</span>
        </button>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Состав урока
        </span>
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Урок №{preview?.lesson_number}
        </h1>
        <p className="text-xs text-slate-500">
          Слова будут объединены в предложения для перевода
        </p>
      </div>

      {preview?.dictionary_exhausted && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="text-xs text-amber-900 leading-snug">
            <strong>Слова в словаре заканчиваются!</strong> Урок начнется с доступным количеством слов.
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Due words (repeats) */}
      {preview?.due_words && preview.due_words.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
            <span>Повторение ({preview.due_words.length})</span>
            <span className="text-[11px] font-normal lowercase text-slate-400">без подсказок перевода</span>
          </div>

          <div className="space-y-2">
            {preview.due_words.map(w => (
              <div
                key={w.word_id}
                className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-2xs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base font-bold text-slate-900">{w.lemma}</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                    {w.pos}
                  </span>
                </div>
                <span className="text-xs text-indigo-600 font-medium">К повторению</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New words */}
      {preview?.new_words && preview.new_words.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
            <span>Новые слова ({preview.new_words.length})</span>
            <span className="text-[11px] font-normal lowercase text-slate-400">нажмите × чтобы исключить</span>
          </div>

          <div className="space-y-2">
            {preview.new_words.map(w => (
              <div
                key={w.word_id}
                className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-2xs group"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-900">{w.lemma}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700">
                      {w.pos}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {w.translations.join(', ')}
                  </div>
                </div>

                <button
                  onClick={() => handleDeclineNewWord(w.word_id)}
                  disabled={decliningWordId === w.word_id}
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                  title="Не добавлять это слово"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Start button */}
      <div className="pt-4">
        <button
          onClick={handleStart}
          className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-200 transition active:scale-[0.99] flex items-center justify-center gap-2 text-base"
        >
          <Sparkles className="w-5 h-5" />
          <span>Поехали!</span>
        </button>
      </div>
    </div>
  );
};
