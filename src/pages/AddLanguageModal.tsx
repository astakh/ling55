import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { X, Globe, Plus } from 'lucide-react';

interface AddLanguageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LanguagePair {
  code: string;
  name: string;
  dictionary_id: string;
  dictionary_name: string;
}

export const AddLanguageModal: React.FC<AddLanguageModalProps> = ({ isOpen, onClose }) => {
  const { user, profiles, reloadProfiles } = useAuth();
  const [pairs, setPairs] = useState<LanguagePair[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('A1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    apiRequest<{ pairs: LanguagePair[] }>('/languages/pairs?native=ru')
      .then(res => {
        // Exclude already studied languages
        const existingCodes = new Set(profiles.map(p => p.target_language));
        const filtered = (res.pairs || []).filter(p => !existingCodes.has(p.code));
        setPairs(filtered);
        if (filtered.length > 0) {
          setSelectedTarget(filtered[0].code);
        }
      })
      .catch(console.error);
  }, [isOpen, profiles]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await apiRequest('/language-profiles', {
        method: 'POST',
        body: JSON.stringify({
          target_language: selectedTarget,
          level: selectedLevel,
        }),
      });
      await reloadProfiles();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка добавления языка');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-slate-900 font-bold">
            <Globe className="w-5 h-5 text-indigo-600" />
            <span>Добавить изучаемый язык</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {pairs.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-sm">
            Вы уже добавили все доступные языки!
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Выберите язык
              </label>
              <select
                value={selectedTarget}
                onChange={e => setSelectedTarget(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {pairs.map(p => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Начальный уровень
              </label>
              <div className="grid grid-cols-4 gap-2">
                {['A1', 'A2', 'B1', 'B2'].map(lvl => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setSelectedLevel(lvl)}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      selectedLevel === lvl
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-100">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 bg-slate-100 text-slate-700 font-semibold rounded-xl text-sm hover:bg-slate-200 transition"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2.5 px-4 bg-indigo-600 text-white font-semibold rounded-xl text-sm hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm"
              >
                {isSubmitting ? 'Добавление...' : 'Добавить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
