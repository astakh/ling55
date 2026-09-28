import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { SentenceReportItem } from '../types';
import {
  Upload,
  CheckCircle,
  AlertTriangle,
  Users,
  Flag,
  Key,
  FileText,
  Search,
  Check,
  Shield,
} from 'lucide-react';

export const AdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'import' | 'reports' | 'users'>('import');

  // Import state
  const [importJson, setImportJson] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Reports state
  const [reports, setReports] = useState<SentenceReportItem[]>([]);
  const [reportsFilter, setReportsFilter] = useState<'all' | 'new' | 'processed'>('new');
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});

  // Users state
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [resetModal, setResetModal] = useState<{ email: string; tempPass: string } | null>(null);

  const loadReports = async () => {
    setIsLoadingReports(true);
    try {
      const filterParam = reportsFilter === 'all' ? '' : `?status=${reportsFilter}`;
      const res = await apiRequest<{ reports: SentenceReportItem[] }>(`/admin/reports${filterParam}`);
      setReports(res.reports || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingReports(false);
    }
  };

  const loadUsers = async () => {
    try {
      const qParam = userSearch ? `?q=${encodeURIComponent(userSearch)}` : '';
      const res = await apiRequest<{ users: any[] }>(`/admin/users${qParam}`);
      setUsers(res.users || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'reports') loadReports();
    if (activeTab === 'users') loadUsers();
  }, [activeTab, reportsFilter, userSearch]);

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsImporting(true);
    setImportError(null);
    setImportReport(null);

    let parsed: any;
    try {
      parsed = JSON.parse(importJson);
    } catch (e: any) {
      setImportError('Некорректный синтаксис JSON: ' + e.message);
      setIsImporting(false);
      return;
    }

    try {
      const res = await apiRequest(`/admin/dictionaries/import?dry_run=${dryRun}`, {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      setImportReport(res);
    } catch (err: any) {
      setImportError(err.message || 'Ошибка импорта словаря');
    } finally {
      setIsImporting(false);
    }
  };

  const handleUpdateReport = async (reportId: string, status: 'processed') => {
    const note = adminNotes[reportId] || '';
    try {
      await apiRequest(`/admin/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, admin_note: note }),
      });
      loadReports();
    } catch (err: any) {
      alert(err.message || 'Ошибка обновления жалобы');
    }
  };

  const handleResetPassword = async (userId: string, email: string) => {
    if (!confirm(`Вы действительно хотите сбросить пароль для ${email}?`)) return;
    try {
      const res = await apiRequest<{ temporary_password: string }>(`/admin/users/${userId}/reset-password`, {
        method: 'POST',
      });
      setResetModal({ email, tempPass: res.temporary_password });
    } catch (err: any) {
      alert(err.message || 'Ошибка сброса пароля');
    }
  };

  const insertSampleJson = () => {
    const sample = {
      schema_version: 1,
      dictionary: {
        code: "travel-en-ru",
        name: "Путешествия и транспорт",
        description: "Полезные слова для аэропорта, отелей и поездок",
        target_language: "en",
        native_language: "ru",
        is_general: false
      },
      words: [
        {
          lemma: "ticket",
          pos: "noun",
          level: "A1",
          translations: ["билет", "проездной"]
        },
        {
          lemma: "luggage",
          pos: "noun",
          level: "A2",
          translations: ["багаж", "вещи"]
        },
        {
          lemma: "arrive",
          pos: "verb",
          level: "A1",
          translations: ["прибывать", "приезжать"]
        },
        {
          lemma: "cancel",
          pos: "verb",
          level: "A2",
          translations: ["отменять", "аннулировать"]
        }
      ]
    };
    setImportJson(JSON.stringify(sample, null, 2));
  };

  return (
    <div className="space-y-6 pb-24 animate-fade-in max-w-[640px] mx-auto">
      <div className="pt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-600" />
            <span>Панель администратора</span>
          </h1>
          <p className="text-xs text-slate-500">Управление словарями, жалобами и пользователями</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
        <button
          onClick={() => setActiveTab('import')}
          className={`flex-1 py-2 rounded-lg transition ${
            activeTab === 'import' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Импорт словарей
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex-1 py-2 rounded-lg transition ${
            activeTab === 'reports' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Жалобы
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2 rounded-lg transition ${
            activeTab === 'users' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Пользователи
        </button>
      </div>

      {/* TAB 1: IMPORT DICTIONARY */}
      {activeTab === 'import' && (
        <form onSubmit={handleImportSubmit} className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                JSON файл словаря (schema_version 1)
              </label>
              <button
                type="button"
                onClick={insertSampleJson}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Вставить пример
              </button>
            </div>

            <textarea
              rows={12}
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              placeholder="Вставьте JSON словаря сюда..."
              className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={e => setDryRun(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>Режим проверки (dry_run) — без записи в БД</span>
              </label>
            </div>

            {importError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-100">
                {importError}
              </div>
            )}

            <button
              type="submit"
              disabled={isImporting || !importJson.trim()}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition disabled:opacity-40"
            >
              {isImporting ? 'Обработка...' : dryRun ? 'Проверить словарь' : 'Применить и сохранить'}
            </button>
          </div>

          {/* Import report */}
          {importReport && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between font-bold text-slate-900 text-sm">
                <span>Отчет по импорту: {importReport.dictionary?.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${importReport.dry_run ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                  {importReport.dry_run ? 'Dry Run' : 'Записано в БД'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2.5 bg-emerald-50 rounded-lg">
                  <div className="text-slate-400 font-medium">Добавлено</div>
                  <div className="text-lg font-bold text-emerald-700">{importReport.added}</div>
                </div>
                <div className="p-2.5 bg-indigo-50 rounded-lg">
                  <div className="text-slate-400 font-medium">Привязано</div>
                  <div className="text-lg font-bold text-indigo-700">{importReport.linked}</div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg">
                  <div className="text-slate-400 font-medium">Пропущено</div>
                  <div className="text-lg font-bold text-slate-600">{importReport.skipped}</div>
                </div>
                <div className="p-2.5 bg-rose-50 rounded-lg">
                  <div className="text-slate-400 font-medium">Ошибок</div>
                  <div className="text-lg font-bold text-rose-600">{importReport.errors}</div>
                </div>
              </div>

              {importReport.error_details && importReport.error_details.length > 0 && (
                <div className="pt-2 space-y-1">
                  <div className="text-xs font-bold text-slate-500">Детали ошибок:</div>
                  <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-rose-600 bg-rose-50/50 p-2 rounded-lg">
                    {importReport.error_details.map((ed: any, idx: number) => (
                      <div key={idx}>
                        Строка {ed.index + 1} ({ed.lemma}): {ed.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {/* TAB 2: REPORTS */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['new', 'processed', 'all'] as const).map(rf => (
              <button
                key={rf}
                onClick={() => setReportsFilter(rf)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  reportsFilter === rf
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {rf === 'new' ? 'Новые' : rf === 'processed' ? 'Обработанные' : 'Все'}
              </button>
            ))}
          </div>

          {isLoadingReports ? (
            <div className="py-12 text-center text-xs text-slate-400">Загрузка жалоб...</div>
          ) : reports.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 text-xs">
              Жалобы не найдены
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map(r => (
                <div
                  key={r.id}
                  className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-2xs text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-500">
                      От: {r.user_email} · {new Date(r.created_at).toLocaleDateString('ru-RU')}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-semibold ${
                        r.status === 'new'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {r.status === 'new' ? 'Новая' : 'Обработана'}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                    <div className="font-bold text-slate-900 text-sm">{r.target_sentence}</div>
                    <div className="text-slate-500">Эталон: {r.reference_translation}</div>
                    {r.user_translation && (
                      <div className="text-slate-700 italic">Ответ: "{r.user_translation}"</div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div>
                      Причина: <strong className="text-slate-900">{r.reason}</strong>
                    </div>
                    {r.comment && (
                      <div>
                        Комментарий: <span className="text-slate-700">{r.comment}</span>
                      </div>
                    )}
                  </div>

                  {r.status === 'new' && (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder="Заметка методиста..."
                        value={adminNotes[r.id] || ''}
                        onChange={e => setAdminNotes({ ...adminNotes, [r.id]: e.target.value })}
                        className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                      />
                      <button
                        onClick={() => handleUpdateReport(r.id, 'processed')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition"
                      >
                        Принять
                      </button>
                    </div>
                  )}

                  {r.admin_note && (
                    <div className="text-slate-500 text-[11px] pt-1">
                      Заметка: {r.admin_note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: USERS */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Поиск пользователя по email..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100 text-xs">
            {users.map(u => (
              <div key={u.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <span>{u.email}</span>
                    {u.is_admin && (
                      <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded font-semibold text-[10px]">
                        Админ
                      </span>
                    )}
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Регистрация: {new Date(u.created_at).toLocaleDateString('ru-RU')} · Пояс: {u.timezone}
                  </div>
                </div>

                <button
                  onClick={() => handleResetPassword(u.id, u.email)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition flex items-center gap-1"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Сбросить пароль</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Временный пароль создан</h3>
            <p className="text-xs text-slate-500">
              Передайте этот временный пароль пользователю <strong>{resetModal.email}</strong>. Все активные сессии пользователя завершены.
            </p>

            <div className="p-3 bg-slate-100 rounded-xl font-mono text-center font-bold text-indigo-700 text-sm select-all">
              {resetModal.tempPass}
            </div>

            <button
              onClick={() => setResetModal(null)}
              className="w-full py-2.5 bg-indigo-600 text-white font-semibold rounded-xl text-xs"
            >
              Понятно, закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
