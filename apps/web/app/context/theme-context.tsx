import React, { createContext, useContext, useEffect, useState } from "react"

type Theme = "light" | "dark"

type ThemeContextType = {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const STORAGE_KEY = "shieldzk-theme"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark")

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
      if (saved === "light" || saved === "dark") {
        setThemeState(saved)
        applyTheme(saved)
      } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
        const initial = prefersDark ? "dark" : "light"
        setThemeState(initial)
        applyTheme(initial)
      }
    } catch {
      applyTheme("dark")
    }
  }, [])

  function applyTheme(newTheme: Theme) {
    if (typeof document !== "undefined") {
      if (newTheme === "dark") {
        document.documentElement.classList.add("dark")
        document.documentElement.classList.remove("light")
      } else {
        document.documentElement.classList.remove("dark")
        document.documentElement.classList.add("light")
      }
    }
  }

  function setTheme(newTheme: Theme) {
    setThemeState(newTheme)
    applyTheme(newTheme)
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch {}
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
