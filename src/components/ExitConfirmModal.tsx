import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ExitConfirmModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ExitConfirmModal: React.FC<ExitConfirmModalProps> = ({
  isOpen,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-100">
        <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 text-center mb-2">
          Выйти из урока?
        </h3>
        <p className="text-sm text-slate-600 text-center mb-6 leading-relaxed">
          Ваш прогресс сохранится. Вы сможете продолжить урок в любое удобное время с главного экрана.
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={onCancel}
            className="w-full py-2.5 px-4 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition shadow-sm"
          >
            Продолжить занятие
          </button>
          <button
            onClick={onConfirm}
            className="w-full py-2.5 px-4 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition"
          >
            Выйти на главную
          </button>
        </div>
      </div>
    </div>
  );
};
