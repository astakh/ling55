import React from 'react';
import { Home, BookOpen, User, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type NavTab = 'home' | 'vocabulary' | 'profile' | 'admin';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  const { user } = useAuth();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200">
      <div className="max-w-[640px] mx-auto px-4 flex items-center justify-around h-16">
        <button
          onClick={() => onTabChange('home')}
          className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
            activeTab === 'home' ? 'text-indigo-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Home className="w-5 h-5 mb-1" />
          <span className="text-xs">Главная</span>
        </button>

        <button
          onClick={() => onTabChange('vocabulary')}
          className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
            activeTab === 'vocabulary' ? 'text-indigo-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="w-5 h-5 mb-1" />
          <span className="text-xs">Словарь</span>
        </button>

        <button
          onClick={() => onTabChange('profile')}
          className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
            activeTab === 'profile' ? 'text-indigo-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <User className="w-5 h-5 mb-1" />
          <span className="text-xs">Профиль</span>
        </button>

        {user?.is_admin && (
          <button
            onClick={() => onTabChange('admin')}
            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
              activeTab === 'admin' ? 'text-indigo-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Shield className="w-5 h-5 mb-1" />
            <span className="text-xs">Админка</span>
          </button>
        )}
      </div>
    </nav>
  );
};
