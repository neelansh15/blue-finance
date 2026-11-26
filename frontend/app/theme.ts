export const THEME_KEY = "blue-theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
export const THEME_COLORS = { light: "#ffffff", dark: "#0b1530" } as const;

// Resolve the initial palette in the head before the page paints.
export const themeInitScript = `(() => {
  const colors = ${JSON.stringify(THEME_COLORS)};
  let theme = matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}).matches ? "dark" : "light";
  try {
    const saved = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if (saved === "light" || saved === "dark") theme = saved;
  } catch {}
  document.documentElement.dataset.theme = theme;
  document.getElementById("blue-theme-color").content = colors[theme];
})();`;
