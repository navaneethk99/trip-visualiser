"use client";

import { useEffect, useRef, useState } from "react";

type Suggestion = {
  id: number;
  label: string;
};

export default function PlaceAutocomplete({
  value,
  onChange,
  label = "Place",
  theme = "light",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  theme?: "light" | "dark";
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDark = theme === "dark";

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    const trimmed = value.trim();

    if (trimmed.length < 2) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/places/search?q=${encodeURIComponent(trimmed)}`,
        );
        const payload = (await response.json()) as { suggestions: Suggestion[] };
        setSuggestions(payload.suggestions ?? []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [value]);

  return (
    <div ref={containerRef} className="relative">
      <label
        className={`block text-xs font-medium uppercase tracking-[0.22em] ${
          isDark ? "text-slate-500" : "text-slate-500"
        }`}
      >
        {label}
      </label>
      <input
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          if (next.trim().length < 2) {
            setSuggestions([]);
            setOpen(false);
          }
          onChange(next);
        }}
        onFocus={() => {
          if (suggestions.length) {
            setOpen(true);
          }
        }}
        placeholder="Type a city, airport, or landmark"
        className={`mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${
          isDark
            ? "border-slate-600 bg-[#1a1f26] text-slate-100 focus:border-teal-500"
            : "border-slate-300 bg-white text-slate-900 focus:border-teal-700"
        }`}
        required
        autoComplete="off"
      />

      {open && suggestions.length ? (
        <div
          className={`absolute z-[1000] mt-2 w-full overflow-hidden rounded-[20px] border shadow-[0_18px_40px_rgba(15,23,42,0.12)] ${
            isDark
              ? "border-slate-700 bg-[#1a1f26]"
              : "border-slate-200 bg-white"
          }`}
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => {
                onChange(suggestion.label);
                setOpen(false);
              }}
              className={`block w-full border-b px-4 py-3 text-left text-sm transition last:border-b-0 ${
                isDark
                  ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                  : "border-slate-100 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
