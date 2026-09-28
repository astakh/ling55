import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { ProfileStatsResponse } from '../types';
import {
  Flame,
  Clock,
  Target,
  Trophy,
  Globe,
  LogOut,
  AlertCircle,
  Plus,
  CheckCircle2,
  Calendar,
} from 'lucide-react';

interface ProfilePageProps {
  onAddLanguage: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onAddLanguage }) => {
  const { user, logout, reloadUser } = useAuth();
  const [stats, setStats] = useState<ProfileStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Timezone change state
  const [timezoneInput, setTimezoneInput] = useState(user?.timezone || 'Europe/Moscow');
  const [isUpdatingTz, setIsUpdatingTz] = useState(false);
  const [tzMessage, setTzMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiRequest<ProfileStatsResponse>('/profile/stats')
      .then(res => setStats(res))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const handleTimezoneUpdate = async () => {
    setIsUpdatingTz(true);
    setTzMessage(null);
    try {
      await apiRequest('/settings/timezone', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: timezoneInput }),
      });
      setTzMessage({
        type: 'success',
        text: 'Часовой пояс успешно обновлен. Граница дня пересчитана.',
      });
      await reloadUser();
    } catch (err: any) {
      setTzMessage({
        type: 'error',
        text: err.message || 'Ошибка обновления часового пояса',
      });
    } finally {
      setIsUpdatingTz(false);
    }
  };

  // Generate heatmap grid for the last 16 weeks (approx 112 days)
  const renderHeatmap = () => {
    if (!stats) return null;
    const days: Array<{ dateStr: string; count: number }> = [];
    const today = new Date();

    for (let i = 111; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const str = d.toISOString().slice(0, 10);
      days.push({
        dateStr: str,
        count: stats.heatmap[str] || 0,
      });
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>Активность за последние 16 недель</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-slate-100" />
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-200" />
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400" />
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
          </div>
        </div>

        <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto p-1 bg-slate-50 rounded-xl border border-slate-100">
          {days.map(d => {
            let color = 'bg-slate-200/80';
            if (d.count >= 3) color = 'bg-emerald-600';
            else if (d.count === 2) color = 'bg-emerald-400';
            else if (d.count === 1) color = 'bg-emerald-200';

            return (
              <div
                key={d.dateStr}
                title={`${d.dateStr}: ${d.count} уроков`}
                className={`w-3.5 h-3.5 rounded-xs ${color} transition`}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-24 animate-fade-in">
      <div className="pt-2">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Профиль и статистика
        </h1>
        <p className="text-xs text-slate-500">{user?.email}</p>
      </div>

      {/* Streak and Accuracy cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold uppercase tracking-wider">
            <Flame className="w-4 h-4 text-amber-500" />
            <span>Текущий стрик</span>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {stats?.streak.current ?? 0}{' '}
            <span className="text-xs font-semibold text-slate-400">дней</span>
          </div>
          <div className="text-[11px] text-slate-400 font-medium">
            Рекорд: {stats?.streak.longest ?? 0} дн.
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold uppercase tracking-wider">
            <Target className="w-4 h-4 text-indigo-600" />
            <span>Точность</span>
          </div>
          <div className="text-2xl font-black text-indigo-600">
            {stats?.accuracy.last_30_days ?? 0}%
          </div>
          <div className="text-[11px] text-slate-400 font-medium">
            За все время: {stats?.accuracy.all_time ?? 0}%
          </div>
        </div>
      </div>

      {/* Heatmap Card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        {renderHeatmap()}
      </div>

      {/* Language Breakdown */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Globe className="w-4 h-4 text-indigo-600" />
            <span>Изучаемые языки</span>
          </div>
          <button
            onClick={onAddLanguage}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Добавить язык</span>
          </button>
        </div>

        <div className="space-y-3">
          {stats?.languages.map(l => (
            <div
              key={l.profile_id}
              className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between font-bold text-slate-800">
                <span className="text-sm">{l.language_name || l.target_language.toUpperCase()}</span>
                <span className="px-2 py-0.5 bg-white border border-slate-200 rounded text-indigo-700">
                  Уровень {l.level}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-slate-600">
                <div>В процессе: <strong className="text-slate-900">{l.words.active}</strong></div>
                <div>Выучено: <strong className="text-emerald-700">{l.words.mastered}</strong></div>
                <div>Уроков: <strong className="text-slate-900">{l.completed_lessons}</strong></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Settings section */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Настройки аккаунта
        </h3>

        {/* Native Language (Read-only) */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            Родной язык (не меняется)
          </label>
          <div className="text-sm font-bold text-slate-800 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200">
            Русский (ru)
          </div>
        </div>

        {/* Timezone */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-500">
            Часовой пояс (IANA)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={timezoneInput}
              onChange={e => setTimezoneInput(e.target.value)}
              className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleTimezoneUpdate}
              disabled={isUpdatingTz || timezoneInput === user?.timezone}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold disabled:opacity-40 transition"
            >
              {isUpdatingTz ? '...' : 'Сохранить'}
            </button>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Смена часового пояса меняет границу дня. Следующую смену можно будет сделать через 7 дней.
          </p>

          {tzMessage && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                tzMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {tzMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{tzMessage.text}</span>
            </div>
          )}
        </div>

        {/* Logout button */}
        <div className="pt-3 border-t border-slate-100">
          <button
            onClick={logout}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Выйти из аккаунта</span>
          </button>
        </div>
      </div>
    </div>
  );
};
