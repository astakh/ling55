import React, { useState, useEffect } from 'react';
import { useAuth, AuthProvider } from './context/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { HomePage } from './pages/HomePage';
import { LessonIntroPage } from './pages/LessonIntroPage';
import { ExercisePage } from './pages/ExercisePage';
import { ReviewPage } from './pages/ReviewPage';
import { LessonSummaryPage } from './pages/LessonSummaryPage';
import { VocabularyPage } from './pages/VocabularyPage';
import { ProfilePage } from './pages/ProfilePage';
import { LanguageSettingsPage } from './pages/LanguageSettingsPage';
import { AdminPage } from './pages/AdminPage';
import { AddLanguageModal } from './pages/AddLanguageModal';
import { BottomNav, NavTab } from './components/BottomNav';
import { EvaluationResponse, CurrentExerciseResponse } from './types';
import { apiRequest } from './api/client';

function AppContent() {
  const { user, isLoading, activeProfile } = useAuth();

  // Navigation tab
  const [activeTab, setActiveTab] = useState<NavTab>('home');

  // Lesson view flow
  type AppView = 'main' | 'lesson_intro' | 'exercise' | 'review' | 'lesson_summary' | 'language_settings';
  const [currentView, setCurrentView] = useState<AppView>('main');

  // Ongoing lesson state
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [currentExercise, setCurrentExercise] = useState<{
    exercise_id: string;
    order_index: number;
    sentence: string;
    total: number;
  } | null>(null);
  const [currentEvaluation, setCurrentEvaluation] = useState<EvaluationResponse | null>(null);

  // Modals
  const [isAddLangOpen, setIsAddLangOpen] = useState(false);

  // Handle Resume lesson from Home
  const handleResumeLesson = async (lId: string) => {
    try {
      const res = await apiRequest<CurrentExerciseResponse>(`/lesson/${lId}/current`);
      setLessonId(lId);
      setCurrentExercise({
        exercise_id: res.exercise_id,
        order_index: res.order_index,
        sentence: res.sentence,
        total: res.exercises_total,
      });
      setCurrentView('exercise');
    } catch (err: any) {
      alert(err.message || 'Не удалось возобновить урок');
    }
  };

  const handleLessonStarted = (
    lId: string,
    firstExId: string,
    orderIndex: number,
    sentence: string,
    total: number
  ) => {
    setLessonId(lId);
    setCurrentExercise({
      exercise_id: firstExId,
      order_index: orderIndex,
      sentence,
      total,
    });
    setCurrentView('exercise');
  };

  const handleExerciseEvaluated = (evaluation: EvaluationResponse) => {
    setCurrentEvaluation(evaluation);
    setCurrentView('review');
  };

  const handleReviewNext = async () => {
    if (!lessonId) return;

    if (currentEvaluation?.lesson_completed) {
      setCurrentView('lesson_summary');
    } else {
      // Fetch next pending exercise
      try {
        const nextEx = await apiRequest<CurrentExerciseResponse>(`/lesson/${lessonId}/current`);
        setCurrentExercise({
          exercise_id: nextEx.exercise_id,
          order_index: nextEx.order_index,
          sentence: nextEx.sentence,
          total: nextEx.exercises_total,
        });
        setCurrentView('exercise');
      } catch (err) {
        // If no more exercises or auto-completed
        setCurrentView('lesson_summary');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Not logged in -> Auth
  if (!user) {
    return <AuthPage />;
  }

  // Logged in, not onboarded -> Onboarding
  if (!user.is_onboarded) {
    return <OnboardingPage />;
  }

  // Render view
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-500 selection:text-white">
      <main className="max-w-[640px] mx-auto px-4 min-h-screen relative">
        {currentView === 'lesson_intro' && (
          <LessonIntroPage
            onBack={() => setCurrentView('main')}
            onLessonStarted={handleLessonStarted}
            onOpenLanguageSettings={() => setCurrentView('language_settings')}
          />
        )}

        {currentView === 'exercise' && currentExercise && lessonId && (
          <ExercisePage
            lessonId={lessonId}
            exerciseId={currentExercise.exercise_id}
            orderIndex={currentExercise.order_index}
            totalExercises={currentExercise.total}
            sentence={currentExercise.sentence}
            onExit={() => {
              setCurrentView('main');
              setActiveTab('home');
            }}
            onEvaluated={handleExerciseEvaluated}
          />
        )}

        {currentView === 'review' && currentEvaluation && (
          <ReviewPage
            evaluation={currentEvaluation}
            onNext={handleReviewNext}
          />
        )}

        {currentView === 'lesson_summary' && lessonId && (
          <LessonSummaryPage
            lessonId={lessonId}
            onHome={() => {
              setLessonId(null);
              setCurrentExercise(null);
              setCurrentEvaluation(null);
              setCurrentView('main');
              setActiveTab('home');
            }}
          />
        )}

        {currentView === 'language_settings' && (
          <LanguageSettingsPage onBack={() => setCurrentView('main')} />
        )}

        {currentView === 'main' && (
          <>
            {activeTab === 'home' && (
              <HomePage
                onStartLesson={() => setCurrentView('lesson_intro')}
                onResumeLesson={handleResumeLesson}
                onOpenVocabulary={() => setActiveTab('vocabulary')}
                onOpenLanguageSettings={() => setCurrentView('language_settings')}
              />
            )}

            {activeTab === 'vocabulary' && <VocabularyPage />}

            {activeTab === 'profile' && (
              <ProfilePage onAddLanguage={() => setIsAddLangOpen(true)} />
            )}

            {activeTab === 'admin' && <AdminPage />}

            <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
          </>
        )}
      </main>

      <AddLanguageModal
        isOpen={isAddLangOpen}
        onClose={() => setIsAddLangOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
