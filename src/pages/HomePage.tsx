import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { DashboardSummary } from '../types';
import { StreakBadge } from '../components/StreakBadge';
import {
  BookOpen,
  ChevronRight,
  Flame,
  Clock,
  Sparkles,
  Layers,
  Settings2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface HomePageProps {
  onStartLesson: () => void;
  onResumeLesson: (lessonId: string) => void;
  onOpenVocabulary: () => void;
  onOpenLanguageSettings: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onStartLesson,
  onResumeLesson,
  onOpenVocabulary,
  onOpenLanguageSettings,
}) => {
  const { user, activeProfile, profiles, switchLanguage } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwitchingLang, setIsSwitchingLang] = useState(false);

  const loadSummary = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiRequest<DashboardSummary>('/dashboard/summary');
      setSummary(data);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки данных');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [activeProfile?.id]);

  const handleLanguageChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    if (newId === activeProfile?.id) return;
    setIsSwitchingLang(true);
    try {
      await switchLanguage(newId);
    } finally {
      setIsSwitchingLang(false);
    }
  };

  if (isLoading && !summary) {
    return (
      <div className="py-24 text-center text-slate-400 flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-sm font-medium">Загрузка данных...</span>
      </div>
    );
  }

  const isAtRisk = summary ? summary.streak.current > 0 && !summary.streak.today_done : false;

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      {/* Top bar with language switcher and streak */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={activeProfile?.id || ''}
              onChange={handleLanguageChange}
              disabled={isSwitchingLang}
              className="appearance-none bg-white border border-slate-200 pl-3 pr-8 py-1.5 rounded-xl text-sm font-bold text-slate-800 shadow-2xs hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.language_name || p.target_language.toUpperCase()} ({p.level})
                </option>
              ))}
            </select>
            <ChevronRight className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
          </div>

          <button
            onClick={onOpenLanguageSettings}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
            title="Настройки языка"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        {summary && <StreakBadge streak={summary.streak} />}
      </div>

      {/* Streak risk notification banner */}
      {isAtRisk && (
        <div className="p-3.5 bg-orange-50/90 border border-orange-200 rounded-2xl flex items-center gap-3 shadow-xs">
          <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 fill-white" />
          </div>
          <div className="text-xs text-orange-900 leading-snug">
            <strong className="block font-bold">Стрик под угрозой!</strong>
            Завершите хотя бы один урок сегодня, чтобы сохранить серию занятий.
          </div>
        </div>
      )}

      {/* Hero card: Today's progress */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              Дневной прогресс
            </div>
            <h2 className="text-xl font-extrabold text-slate-900">
              Сегодня: {summary?.lessons_today ?? 0} из {summary?.daily_lesson_limit ?? 1} начато
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">Словарь</span>
            <div className="text-xs font-semibold text-slate-700 truncate max-w-[140px]">
              {summary?.profile?.dictionary?.name || 'Общий'}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex gap-1">
            {Array.from({ length: summary?.daily_lesson_limit || 1 }).map((_, idx) => (
              <div
                key={idx}
                className={`flex-1 h-full rounded-full transition-all duration-300 ${
                  idx < (summary?.lessons_today || 0) ? 'bg-indigo-600' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* CTA Main Button */}
        {summary?.cta === 'resume' && summary.resume ? (
          <button
            onClick={() => onResumeLesson(summary.resume!.lesson_id)}
            className="w-full py-4 px-6 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-sm transition active:scale-[0.99] flex items-center justify-center gap-2 text-base"
          >
            <RefreshCw className="w-5 h-5 animate-spin-slow" />
            <span>Продолжить урок ({summary.resume.exercises_done} из {summary.resume.exercises_total})</span>
          </button>
        ) : summary?.cta === 'limit_reached' ? (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Clock className="w-4 h-4 text-slate-500" />
              <span>Дневной лимит исчерпан</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Новый лимит станет доступен в полночь по вашему часовому поясу.
              Вы можете изменить дневной лимит в{' '}
              <button
                onClick={onOpenLanguageSettings}
                className="text-indigo-600 font-semibold underline underline-offset-2"
              >
                настройках языка
              </button>.
            </p>
          </div>
        ) : (
          <button
            onClick={onStartLesson}
            className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-200 transition active:scale-[0.99] flex items-center justify-center gap-2 text-base"
          >
            <Sparkles className="w-5 h-5" />
            <span>Начать урок</span>
          </button>
        )}
      </div>

      {/* Words Summary Card */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-bold">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <span>Слова в обучении</span>
          </div>
          <button
            onClick={onOpenVocabulary}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
          >
            <span>В словарь</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div
            onClick={onOpenVocabulary}
            className="p-3 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-100/60 transition"
          >
            <div className="text-xs font-semibold text-slate-400 mb-0.5">В процессе</div>
            <div className="text-xl font-extrabold text-indigo-600">
              {summary?.words.active ?? 0}
            </div>
          </div>

          <div
            onClick={onOpenVocabulary}
            className="p-3 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-100/60 transition"
          >
            <div className="text-xs font-semibold text-slate-400 mb-0.5">Выучено</div>
            <div className="text-xl font-extrabold text-emerald-600">
              {summary?.words.mastered ?? 0}
            </div>
          </div>

          <div
            onClick={onOpenVocabulary}
            className="p-3 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-100/60 transition"
          >
            <div className="text-xs font-semibold text-slate-400 mb-0.5">Исключено</div>
            <div className="text-xl font-extrabold text-slate-400">
              {summary?.words.ignored ?? 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
