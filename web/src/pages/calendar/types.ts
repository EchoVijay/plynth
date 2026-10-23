export interface CalEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_date: string;
  event_time: string | null;
  end_date: string | null;
  end_time: string | null;
  is_all_day: boolean;
  completed: boolean;
  category: string;
  recurrence: string | null;
  color: string | null;
  reminder_minutes: number[];
  is_auto: boolean;
  source_type: string | null;
}

export type ViewMode = 'day' | 'workweek' | 'week' | 'month' | 'agenda';

export const VIEW_OPTIONS: { id: ViewMode; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'workweek', label: 'Work week' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'agenda', label: 'Agenda' },
];

// Tailwind needs full class names, so every colour is spelled out.
export interface ColorStyle {
  label: string;
  swatch: string;
  block: string;
  bar: string;
  text: string;
}

export const COLORS: Record<string, ColorStyle> = {
  indigo: { label: 'Indigo', swatch: 'bg-indigo-500', block: 'bg-indigo-100 dark:bg-indigo-500/25', bar: 'bg-indigo-500', text: 'text-indigo-950 dark:text-indigo-100' },
  blue: { label: 'Blue', swatch: 'bg-blue-500', block: 'bg-blue-100 dark:bg-blue-500/25', bar: 'bg-blue-500', text: 'text-blue-950 dark:text-blue-100' },
  teal: { label: 'Teal', swatch: 'bg-teal-500', block: 'bg-teal-100 dark:bg-teal-500/25', bar: 'bg-teal-500', text: 'text-teal-950 dark:text-teal-100' },
  green: { label: 'Green', swatch: 'bg-green-500', block: 'bg-green-100 dark:bg-green-500/25', bar: 'bg-green-500', text: 'text-green-950 dark:text-green-100' },
  amber: { label: 'Amber', swatch: 'bg-amber-500', block: 'bg-amber-100 dark:bg-amber-500/25', bar: 'bg-amber-500', text: 'text-amber-950 dark:text-amber-100' },
  orange: { label: 'Orange', swatch: 'bg-orange-500', block: 'bg-orange-100 dark:bg-orange-500/25', bar: 'bg-orange-500', text: 'text-orange-950 dark:text-orange-100' },
  pink: { label: 'Pink', swatch: 'bg-pink-500', block: 'bg-pink-100 dark:bg-pink-500/25', bar: 'bg-pink-500', text: 'text-pink-950 dark:text-pink-100' },
  rose: { label: 'Rose', swatch: 'bg-rose-500', block: 'bg-rose-100 dark:bg-rose-500/25', bar: 'bg-rose-500', text: 'text-rose-950 dark:text-rose-100' },
  purple: { label: 'Purple', swatch: 'bg-purple-500', block: 'bg-purple-100 dark:bg-purple-500/25', bar: 'bg-purple-500', text: 'text-purple-950 dark:text-purple-100' },
  slate: { label: 'Slate', swatch: 'bg-slate-500', block: 'bg-slate-200 dark:bg-slate-500/25', bar: 'bg-slate-500', text: 'text-slate-900 dark:text-slate-100' },
};

export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
  pickable: boolean;
}

export const CATEGORIES: Category[] = [
  { id: 'work', label: 'Work', emoji: '💻', color: 'indigo', pickable: true },
  { id: 'focus', label: 'Focus time', emoji: '🎯', color: 'blue', pickable: true },
  { id: 'study', label: 'Study', emoji: '📚', color: 'purple', pickable: true },
  { id: 'personal', label: 'Personal', emoji: '🧘', color: 'teal', pickable: true },
  { id: 'general', label: 'General', emoji: '📌', color: 'slate', pickable: true },
  { id: 'interview', label: 'Interview', emoji: '💼', color: 'blue', pickable: true },
  { id: 'exam', label: 'Exam', emoji: '📝', color: 'purple', pickable: true },
  { id: 'birthday', label: 'Birthday', emoji: '🎂', color: 'pink', pickable: true },
  { id: 'bill', label: 'Bill', emoji: '🧾', color: 'orange', pickable: true },
  { id: 'emi', label: 'EMI', emoji: '💰', color: 'amber', pickable: false },
  { id: 'period', label: 'Period', emoji: '🩸', color: 'rose', pickable: false },
  { id: 'other', label: 'Other', emoji: '📌', color: 'slate', pickable: false },
];

export const REMINDER_OPTIONS = [
  { value: 0, label: 'At start' },
  { value: 5, label: '5 min before' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
];

export const RECURRENCE_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export function getCategory(id: string): Category {
  return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[4];
}

export function getColorStyle(event: Pick<CalEvent, 'color' | 'category'>): ColorStyle {
  const key = event.color && COLORS[event.color] ? event.color : getCategory(event.category).color;
  return COLORS[key];
}
