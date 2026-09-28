import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { apiRequest } from '../api/client';
import { LessonSummaryResponse } from '../types';
import { Trophy, Flame, CheckCircle, AlertTriangle, XCircle, ArrowRight, Sparkles } from 'lucide-react';

interface LessonSummaryPageProps {
  lessonId: string;
  onHome: () => void;
}

export const LessonSummaryPage: React.FC<LessonSummaryPageProps> = ({
  lessonId,
  onHome,
}) => {
  const [summary, setSummary] = useState<LessonSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<LessonSummaryResponse>(`/lesson/${lessonId}/summary`)
      .then(res => {
        setSummary(res);
        if (res.streak.extended_today) {
          // Launch celebratory confetti
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
          });
        }
      })
      .catch(err => setError(err.message || 'Ошибка загрузки итогов урока'))
      .finally(() => setIsLoading(false));
  }, [lessonId]);

  if (isLoading) {
    return (
      <div className="py-24 text-center text-slate-400 flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-sm font-medium">Подсчитываем результаты...</span>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-rose-600 text-sm">{error || 'Урок не найден'}</p>
        <button
          onClick={onHome}
          className="py-2.5 px-5 bg-indigo-600 text-white font-semibold rounded-xl text-sm"
        >
          На главную
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-between py-8 max-w-[640px] mx-auto px-4 animate-fade-in pb-12">
      <div className="space-y-6">
        {/* Celebration header */}
        <div className="text-center space-y-2 pt-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-500 border border-amber-200 flex items-center justify-center mx-auto shadow-sm">
            <Trophy className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Урок №{summary.lesson_number} завершён!
          </h1>
          <p className="text-sm text-slate-500">
            Отличная работа. Интервалы повторения обновлены.
          </p>
        </div>

        {/* Streak card */}
        <div className="p-5 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl text-white shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Flame className="w-5 h-5 fill-white text-white" />
              </div>
              <span className="font-bold text-sm tracking-wide">
                {summary.streak.extended_today ? 'Стрик продлен!' : 'Серия занятий'}
              </span>
            </div>
            <div className="text-xs bg-white/20 px-2.5 py-1 rounded-full font-semibold">
              Рекорд: {summary.streak.longest} {summary.streak.longest === 1 ? 'день' : 'дней'}
            </div>
          </div>

          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-3xl font-black tracking-tight">{summary.streak.current}</span>
            <span className="text-sm font-medium opacity-90">
              {summary.streak.current === 1 ? 'день подряд' : 'дней подряд'}
            </span>
          </div>
        </div>

        {/* Breakdown Stats Grid */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Статистика урока
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs text-slate-400 font-medium">Слов проверено</div>
              <div className="text-xl font-bold text-slate-800">{summary.words_total}</div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs text-slate-400 font-medium">Без ошибок</div>
              <div className="text-xl font-bold text-emerald-600">{summary.without_errors}</div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs text-slate-400 font-medium">Повторено</div>
              <div className="text-xl font-bold text-slate-700">{summary.reviewed}</div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs text-slate-400 font-medium">Новых слов</div>
              <div className="text-xl font-bold text-indigo-600">{summary.new_words}</div>
            </div>
          </div>

          {/* Accuracy pill details */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-around text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              Верно: <strong>{summary.correct}</strong>
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              Опечаток: <strong>{summary.typo}</strong>
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5 text-rose-600" />
              Ошибок: <strong>{summary.incorrect}</strong>
            </span>
          </div>

          {summary.suggestions_added > 0 && (
            <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 flex items-center gap-2 text-xs text-indigo-900 font-medium">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Добавлено новых слов из контекста: {summary.suggestions_added}</span>
            </div>
          )}
        </div>
      </div>

      {/* Button */}
      <div className="pt-6">
        <button
          onClick={onHome}
          className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-200 transition active:scale-[0.99] flex items-center justify-center gap-2 text-base"
        >
          <span>На главную</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
