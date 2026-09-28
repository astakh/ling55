import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { EvaluationResponse } from '../types';
import { ExitConfirmModal } from '../components/ExitConfirmModal';
import { ReportModal } from '../components/ReportModal';
import { Flag, X, ArrowRight, AlertCircle, HelpCircle } from 'lucide-react';

interface ExercisePageProps {
  lessonId: string;
  exerciseId: string;
  orderIndex: number;
  totalExercises: number;
  sentence: string;
  onExit: () => void;
  onEvaluated: (res: EvaluationResponse) => void;
}

export const ExercisePage: React.FC<ExercisePageProps> = ({
  lessonId,
  exerciseId,
  orderIndex,
  totalExercises,
  sentence,
  onExit,
  onEvaluated,
}) => {
  const draftKey = `exercise_draft_${exerciseId}`;
  const [translation, setTranslation] = useState<string>(() => {
    return localStorage.getItem(draftKey) || '';
  });

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Auto-save draft
  useEffect(() => {
    if (translation) {
      localStorage.setItem(draftKey, translation);
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [translation, draftKey]);

  // Intercept browser back/popstate
  useEffect(() => {
    window.history.pushState({ inLesson: true }, '');

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState({ inLesson: true }, '');
      setIsExitModalOpen(true);
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const handleEvaluate = async (dontKnow = false) => {
    if (!dontKnow && !translation.trim()) return;

    setIsEvaluating(true);
    setErrorToast(null);

    try {
      const res = await apiRequest<EvaluationResponse>('/lesson/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          exercise_id: exerciseId,
          user_translation: dontKnow ? null : translation.trim(),
          dont_know: dontKnow,
        }),
      });

      // Clear draft
      localStorage.removeItem(draftKey);
      onEvaluated(res);
    } catch (err: any) {
      console.error('Evaluation error:', err);
      setErrorToast(err.message || 'Сервер перегружен, попробуйте ещё раз');
      setIsEvaluating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between py-6 max-w-[640px] mx-auto px-4 animate-fade-in">
      {/* Header bar: Exit & Progress & Report */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsExitModalOpen(true)}
            className="p-2 -ml-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition"
            title="Выйти из урока"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Progress pill */}
          <span className="text-xs font-bold text-slate-500 tracking-wide">
            Упражнение {orderIndex + 1} из {totalExercises}
          </span>

          <button
            onClick={() => setIsReportModalOpen(true)}
            className="p-2 -mr-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition"
            title="Сообщить об ошибке"
          >
            <Flag className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex gap-1">
          {Array.from({ length: totalExercises }).map((_, idx) => (
            <div
              key={idx}
              className={`flex-1 h-full rounded-full transition-all duration-300 ${
                idx <= orderIndex ? 'bg-indigo-600' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Main card */}
      <div className="my-auto py-8 space-y-6">
        <div>
          <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider block mb-2">
            Переведите предложение
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 leading-snug tracking-tight">
            {sentence}
          </h2>
        </div>

        {/* Multiline translation textarea */}
        <div className="relative">
          <textarea
            value={translation}
            onChange={e => setTranslation(e.target.value.slice(0, 500))}
            disabled={isEvaluating}
            rows={4}
            placeholder="Введите перевод на русском языке..."
            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition shadow-xs resize-none disabled:bg-slate-50 disabled:text-slate-500"
          />
          <div className="absolute right-3 bottom-3 text-xs text-slate-400 font-mono">
            {translation.length} / 500
          </div>
        </div>

        {/* Error toast if any */}
        {errorToast && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorToast}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <div className="flex gap-3">
          <button
            type="button"
            disabled={isEvaluating}
            onClick={() => handleEvaluate(true)}
            className="py-3.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition disabled:opacity-50 shrink-0"
          >
            Не знаю
          </button>

          <button
            type="button"
            disabled={isEvaluating || !translation.trim()}
            onClick={() => handleEvaluate(false)}
            className="flex-1 py-3.5 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-200 transition active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base"
          >
            {isEvaluating ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Проверить</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Modals */}
      <ExitConfirmModal
        isOpen={isExitModalOpen}
        onCancel={() => setIsExitModalOpen(false)}
        onConfirm={() => {
          setIsExitModalOpen(false);
          onExit();
        }}
      />

      <ReportModal
        exerciseId={exerciseId}
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
      />
    </div>
  );
};
