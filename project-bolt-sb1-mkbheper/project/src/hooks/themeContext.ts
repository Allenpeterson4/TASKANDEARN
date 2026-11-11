import { createContext } from 'react';

export type Theme = 'dark' | 'light';

export interface ThemeColors {
  accent: string;
  accentSecondary: string;
  success: string;
  danger: string;
  info: string;
  darkBackground: string;
  darkSurface: string;
  darkText: string;
  darkMuted: string;
  darkBorder: string;
  lightBackground: string;
  lightSurface: string;
  lightText: string;
  lightMuted: string;
  lightBorder: string;
}

export const defaultThemeColors: ThemeColors = {
  accent: '#f59e0b',
  accentSecondary: '#f97316',
  success: '#22c55e',
  danger: '#ef4444',
  info: '#3b82f6',
  darkBackground: '#080808',
  darkSurface: '#111111',
  darkText: '#f9fafb',
  darkMuted: '#9ca3af',
  darkBorder: '#ffffff',
  lightBackground: '#f4f6f8',
  lightSurface: '#ffffff',
  lightText: '#17212b',
  lightMuted: '#586574',
  lightBorder: '#182738',
};

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  colors: ThemeColors;
  setColors: (colors: ThemeColors) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);