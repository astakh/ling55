import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { Globe, Clock, Compass, Award, ArrowRight, Check } from 'lucide-react';

interface LanguagePair {
  code: string;
  name: string;
  dictionary_id: string;
  dictionary_name: string;
}

export const OnboardingPage: React.FC = () => {
  const { reloadUser } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form states
  const [nativeLanguage, setNativeLanguage] = useState('ru');
  const [timezone, setTimezone] = useState('Europe/Moscow');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [level, setLevel] = useState('A2');

  const [availablePairs, setAvailablePairs] = useState<LanguagePair[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Detect timezone
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch (e) {
      // Fallback
    }

    // Load supported language pairs
    apiRequest<{ pairs: LanguagePair[] }>('/languages/pairs?native=ru')
      .then(res => {
        setAvailablePairs(res.pairs || []);
        if (res.pairs && res.pairs.length > 0) {
          setTargetLanguage(res.pairs[0].code);
        }
      })
      .catch(console.error);
  }, []);

  const handleComplete = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest('/onboarding/complete', {
        method: 'POST',
        body: JSON.stringify({
          native_language: nativeLanguage,
          timezone,
          target_language: targetLanguage,
          level,
        }),
      });
      await reloadUser();
    } catch (err: any) {
      setError(err.message || 'Ошибка завершения онбординга');
      setIsSubmitting(false);
    }
  };

  const levelsMeta = [
    { code: 'A1', title: 'A1 — Начальный', desc: 'Базовые фразы, простые слова и простейшие конструкции' },
    { code: 'A2', title: 'A2 — Элементарный', desc: 'Повседневные темы, простые предложения и диалоги' },
    { code: 'B1', title: 'B1 — Средний', desc: 'Уверенное понимание сути текстов, развернутые фразы' },
    { code: 'B2', title: 'B2 — Выше среднего', desc: 'Сложные темы, идиоматические обороты и беглая речь' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-8">
      <div className="max-w-[480px] w-full mx-auto space-y-6">
        {/* Progress tracker */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Шаг {step} из 3</span>
            <span>
              {step === 1 ? 'Родной язык и пояс' : step === 2 ? 'Изучаемый язык' : 'Ваш уровень'}
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden flex gap-1">
            <div className={`flex-1 h-full bg-indigo-600 transition-all`} />
            <div className={`flex-1 h-full ${step >= 2 ? 'bg-indigo-600' : 'bg-transparent'} transition-all`} />
            <div className={`flex-1 h-full ${step >= 3 ? 'bg-indigo-600' : 'bg-transparent'} transition-all`} />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
          {/* STEP 1: Native language & Timezone */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">
                  Настройка языкового окружения
                </h2>
                <p className="text-sm text-slate-500">
                  Предложения будут переводиться на ваш родной язык.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-indigo-600" />
                    Родной язык (не меняется)
                  </label>
                  <select
                    value={nativeLanguage}
                    onChange={e => setNativeLanguage(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="ru">Русский</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Родной язык задается один раз и определяет направление перевода.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    Часовой пояс
                  </label>
                  <input
                    type="text"
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Нужен для точного учета стрика и сброса дневного лимита уроков в полночь.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition flex items-center justify-center gap-2 shadow-sm"
              >
                <span>Далее</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* STEP 2: Target Language */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">
                  Какой язык вы хотите учить?
                </h2>
                <p className="text-sm text-slate-500">
                  Позже вы сможете добавить и другие языки в свой профиль.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {availablePairs.map(pair => (
                  <button
                    key={pair.code}
                    type="button"
                    onClick={() => setTargetLanguage(pair.code)}
                    className={`p-4 rounded-xl border text-left flex items-center justify-between transition ${
                      targetLanguage === pair.code
                        ? 'border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-900 text-base">{pair.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{pair.dictionary_name}</div>
                    </div>
                    {targetLanguage === pair.code && (
                      <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="py-3 px-4 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-1 py-3 px-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition flex items-center justify-center gap-2 shadow-sm"
                >
                  <span>Далее</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Level */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">
                  Ваш текущий уровень
                </h2>
                <p className="text-sm text-slate-500">
                  Уровень влияет на сложность сгенерированных предложений и подбор новых слов.
                </p>
              </div>

              <div className="space-y-2.5">
                {levelsMeta.map(item => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setLevel(item.code)}
                    className={`w-full p-4 rounded-xl border text-left transition ${
                      level === item.code
                        ? 'border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-slate-900 text-sm">{item.title}</span>
                      {level === item.code && (
                        <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                  </button>
                ))}
              </div>

              {error && (
                <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-100">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="py-3 px-4 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition"
                >
                  Назад
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleComplete}
                  className="flex-1 py-3 px-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-sm"
                >
                  {isSubmitting ? 'Завершаем...' : 'Начать обучение'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
