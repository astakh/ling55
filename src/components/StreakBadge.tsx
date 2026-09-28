import React from 'react';
import { Flame } from 'lucide-react';
import { StreakInfo } from '../types';

interface StreakBadgeProps {
  streak: StreakInfo;
  onClick?: () => void;
}

export const StreakBadge: React.FC<StreakBadgeProps> = ({ streak, onClick }) => {
  const isAtRisk = streak.current > 0 && !streak.today_done;

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all cursor-pointer ${
        streak.current > 0
          ? streak.today_done
            ? 'bg-amber-50 text-amber-800 border border-amber-200 shadow-sm'
            : 'bg-orange-50 text-orange-700 border border-orange-300'
          : 'bg-slate-100 text-slate-500 border border-slate-200'
      }`}
      title={
        isAtRisk
          ? 'Позанимайтесь сегодня, чтобы сохранить стрик!'
          : streak.today_done
          ? 'Стрик продлен на сегодня!'
          : 'Начните ежедневные занятия для роста стрика'
      }
    >
      <Flame
        className={`w-4 h-4 ${
          streak.current > 0
            ? streak.today_done
              ? 'text-amber-500 fill-amber-500'
              : 'text-orange-500 animate-pulse fill-orange-400'
            : 'text-slate-400'
        }`}
      />
      <span className="text-sm font-bold tracking-tight">{streak.current}</span>
      {isAtRisk && (
        <span className="w-2 h-2 rounded-full bg-orange-500" title="Под угрозой" />
      )}
    </div>
  );
};
