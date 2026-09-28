import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { ArrowLeft, Save, BookOpen, Layers, Check } from 'lucide-react';

interface LanguageSettingsPageProps {
  onBack: () => void;
}

interface DictionaryOption {
  id: string;
  code: string;
  name: string;
  description: string;
  is_general: boolean;
  words_total: number;
}

export const LanguageSettingsPage: React.FC<LanguageSettingsPageProps> = ({ onBack }) => {
  const { activeProfile, reloadProfiles } = useAuth();

  const [level, setLevel] = useState(activeProfile?.level || 'A1');
  const [dictionaryId, setDictionaryId] = useState(activeProfile?.dictionary_id || '');
  const [dailyLimit, setDailyLimit] = useState(activeProfile?.daily_lesson_limit || 1);

  const [availableDicts, setAvailableDicts] = useState<DictionaryOption[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProfile) return;
    setLevel(activeProfile.level);
    setDictionaryId(activeProfile.dictionary_id);
    setDailyLimit(activeProfile.daily_lesson_limit);

    // Fetch dictionaries for this language pair
    apiRequest<{ dictionaries: DictionaryOption[] }>(
      `/dictionaries?target_language=${activeProfile.target_language}`
    )
      .then(res => setAvailableDicts(res.dictionaries || []))
      .catch(console.error);
  }, [activeProfile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProfile) return;

    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      await apiRequest(`/language-profiles/${activeProfile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          level,
          dictionary_id: dictionaryId,
          daily_lesson_limit: dailyLimit,
        }),
      });

      await reloadProfiles();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения настроек');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-24 animate-fade-in max-w-[640px] mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Назад</span>
        </button>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Настройки языка ({activeProfile?.language_name || activeProfile?.target_language.toUpperCase()})
        </span>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Level selection */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
            Уровень сложности
          </label>
          <p className="text-xs text-slate-500">
            Влияет на подбор новых слов из активного словаря и сложность сгенерированных предложений.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {['A1', 'A2', 'B1', 'B2'].map(lvl => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                className={`p-3 rounded-xl border text-sm font-bold transition flex items-center justify-between ${
                  level === lvl
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-1 ring-indigo-600'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <span>Уровень {lvl}</span>
                {level === lvl && <Check className="w-4 h-4 text-indigo-600" />}
              </button>
            ))}
          </div>
        </div>

        {/* Dictionary selection */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
            Активный словарь
          </label>
          <p className="text-xs text-slate-500">
            Новые слова будут подбираться из этого словаря. Уже изучаемые слова остаются в повторении.
          </p>

          <div className="space-y-2">
            {availableDicts.map(dict => (
              <button
                key={dict.id}
                type="button"
                onClick={() => setDictionaryId(dict.id)}
                className={`w-full p-3.5 rounded-xl border text-left transition flex items-center justify-between ${
                  dictionaryId === dict.id
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-950 ring-1 ring-indigo-600'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">{dict.name}</span>
                    {dict.is_general && (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                        Общий
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{dict.description}</div>
                  <div className="text-[11px] text-indigo-600 font-medium pt-0.5">
                    Слов в словаре: {dict.words_total}
                  </div>
                </div>

                {dictionaryId === dict.id && (
                  <Check className="w-5 h-5 text-indigo-600 shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Daily lesson limit slider */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
              Дневной лимит уроков
            </label>
            <span className="text-lg font-black text-indigo-600">
              {dailyLimit} {dailyLimit === 1 ? 'урок в день' : 'уроков в день'}
            </span>
          </div>

          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={dailyLimit}
            onChange={e => setDailyLimit(parseInt(e.target.value, 10))}
            className="w-full accent-indigo-600 cursor-pointer"
          />

          <div className="flex justify-between text-xs text-slate-400 font-semibold px-1">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Применяется сразу: если новый лимит не больше числа начатых сегодня уроков, обучение будет приостановлено до полуночи.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-100">
            {error}
          </div>
        )}

        {saveSuccess && (
          <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 font-semibold text-center">
            Настройки успешно сохранены!
          </div>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-200 transition active:scale-[0.99] flex items-center justify-center gap-2 text-base"
        >
          <Save className="w-5 h-5" />
          <span>{isSaving ? 'Сохранение...' : 'Сохранить изменения'}</span>
        </button>
      </form>
    </div>
  );
};
