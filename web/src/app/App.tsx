import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';
import { AppShell } from './AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LearningPage } from '@/pages/LearningPage';
import { JobsPage } from '@/pages/JobsPage';
import { TodosPage } from '@/pages/TodosPage';
import { NotesPage } from '@/pages/NotesPage';
import { PeriodPage } from '@/pages/PeriodPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { FinancePage } from '@/pages/FinancePage';
import { BookmarksPage } from '@/pages/BookmarksPage';
import { HabitsPage } from '@/pages/HabitsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ChatPage } from '@/pages/ChatPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/onboarding" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
      <Route element={<AuthGuard><AppShell /></AuthGuard>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/learning" element={<LearningPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/period" element={<PeriodPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/bookmarks" element={<BookmarksPage />} />
        <Route path="/habits" element={<HabitsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
