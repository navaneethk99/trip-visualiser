"use client";

import dynamic from "next/dynamic";
import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import JourneyFlow from "../components/journey-flow";

type Theme = "light" | "dark";

type StopInput = {
  id: string;
  place: string;
  datetime: string;
};

type ResolvedStop = StopInput & {
  displayName: string;
  latitude: number;
  longitude: number;
};

type TravelOption = {
  mode: string;
  reason: string;
  durationHours: number;
  estimatedCost: number;
  confidence: "low" | "medium" | "high";
};

type JourneyLeg = {
  id: string;
  fromStopId: string;
  toStopId: string;
  from: string;
  to: string;
  originScheduledTime: string;
  recommendedDeparture: string;
  arrivalDeadline: string;
  distanceKm: number;
  fastest: TravelOption;
  cheapest: TravelOption;
  options: TravelOption[];
  evidenceSources: string[];
};

type TravelResponse = {
  stops: ResolvedStop[];
  legs: JourneyLeg[];
  limitations: string[];
};

type AnalysisStreamEvent =
  | {
      type: "progress";
      percent: number;
      stage: string;
      detail?: string;
    }
  | {
      type: "result";
      data: TravelResponse;
    }
  | {
      type: "error";
      error: string;
    };

const OsmMap = dynamic(() => import("../components/osm-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] items-center justify-center rounded-[28px] border border-slate-200 bg-slate-50 text-sm text-slate-500">
      Loading map…
    </div>
  ),
});

const INITIAL_STOPS: StopInput[] = [
  { id: createId(), place: "New York City, USA", datetime: "2026-06-12T09:00" },
  { id: createId(), place: "London, United Kingdom", datetime: "2026-06-14T08:30" },
  { id: createId(), place: "Paris, France", datetime: "2026-06-16T11:00" },
];

const THEME_STORAGE_KEY = "orbit-planner-theme";
const THEME_CHANGE_EVENT = "orbit-planner-theme-change";

function subscribeToThemePreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      onStoreChange();
    }
  };

  const handleThemeChange = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  };
}

function getThemePreferenceSnapshot(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

export default function Home() {
  const [stops, setStops] = useState<StopInput[]>(INITIAL_STOPS);
  const theme = useSyncExternalStore(
    subscribeToThemePreference,
    getThemePreferenceSnapshot,
    () => "light",
  );
  const [journey, setJourney] = useState<TravelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModes, setSelectedModes] = useState<Record<string, string>>({});
  const [analysisProgress, setAnalysisProgress] = useState<{
    percent: number;
    stage: string;
    detail?: string;
  } | null>(null);

  useEffect(() => {
    void analyseStops(INITIAL_STOPS);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function updateTheme(nextTheme: Theme) {
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  async function analyseStops(nextStops: StopInput[]) {
    setLoading(true);
    setError(null);
    setAnalysisProgress({
      percent: 2,
      stage: "Starting analysis",
    });

    try {
      const response = await fetch("/api/travel-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: nextStops }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Unable to analyse route");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: TravelResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(line) as AnalysisStreamEvent;

          if (event.type === "progress") {
            setAnalysisProgress({
              percent: event.percent,
              stage: event.stage,
              detail: event.detail,
            });
          }

          if (event.type === "result") {
            finalPayload = event.data;
          }

          if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      }

      if (!finalPayload) {
        throw new Error("Analysis did not return a route.");
      }

      setJourney(finalPayload);
      setSelectedModes(
        Object.fromEntries(
          finalPayload.legs.map((leg) => [leg.fromStopId, leg.fastest.mode]),
        ),
      );
      setAnalysisProgress({
        percent: 100,
        stage: "Analysis complete",
      });
    } catch (requestError) {
      setJourney(null);
      setError(
        requestError instanceof Error ? requestError.message : "Unable to analyse route",
      );
      setAnalysisProgress(null);
    } finally {
      setLoading(false);
    }
  }

  async function analyseTrip(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await analyseStops(stops);
  }

  async function importItinerary(file: File) {
    setImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/itinerary-import", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | { stops: Array<{ place: string; datetime: string }> }
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Unable to import itinerary");
      }

      const importedStops = payload.stops.map((stop) => ({
        id: createId(),
        place: stop.place,
        datetime: stop.datetime,
      }));

      if (importedStops.length < 2) {
        throw new Error("Gemini could not extract at least two usable itinerary stops.");
      }

      setJourney(null);
      setStops(importedStops);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to import itinerary",
      );
    } finally {
      setImporting(false);
    }
  }

  function updateStop(id: string, field: keyof StopInput, value: string) {
    setJourney(null);
    setStops((current) =>
      current.map((stop) => (stop.id === id ? { ...stop, [field]: value } : stop)),
    );
  }

  function addStop() {
    setJourney(null);
    setStops((current) => [...current, { id: createId(), place: "", datetime: "" }]);
  }

  function removeStop(id: string) {
    setJourney(null);
    setStops((current) => current.filter((stop) => stop.id !== id));
  }

  async function reorderStops(nextIds: string[]) {
    const stopMap = new Map(stops.map((stop) => [stop.id, stop]));
    const nextStops = nextIds
      .map((id) => stopMap.get(id))
      .filter((stop): stop is StopInput => Boolean(stop));

    if (nextStops.length !== stops.length) {
      return;
    }

    setJourney(null);
    setStops(nextStops);
  }

  const isDark = theme === "dark";

  return (
    <main
      className={`min-h-screen transition-colors ${
        isDark ? "bg-[#0b1220] text-slate-100" : "bg-[#f4f1ea] text-slate-900"
      }`}
    >
      <div className="w-full px-5 py-8 lg:px-8 lg:py-10">
        <section
          className={`rounded-[32px] border p-6 shadow-[0_12px_40px_rgba(15,23,42,0.06)] ${
            isDark ? "border-white/10 bg-[#111827]" : "border-black/8 bg-white"
          }`}
        >
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p
                className={`text-xs font-medium uppercase tracking-[0.3em] ${
                  isDark ? "text-slate-400" : "text-slate-500"
                }`}
              >
                Orbit Planner
              </p>
              <h1
                className={`mt-3 text-4xl font-semibold tracking-tight ${
                  isDark ? "text-slate-50" : "text-slate-950"
                }`}
              >
                Build and retrace the route directly on the graph.
              </h1>
              <p className={`mt-3 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                Add, delete, edit, and drag stops inside the node graph. After the route
                looks right, run analysis to calculate travel times, departure windows,
                and transport options.
              </p>
            </div>

            <form className="flex flex-wrap gap-3" onSubmit={analyseTrip}>
              <button
                type="button"
                onClick={() => updateTheme(theme === "light" ? "dark" : "light")}
                className={`rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                  isDark
                    ? "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {isDark ? "Switch to light mode" : "Switch to dark mode"}
              </button>
              <label
                className={`cursor-pointer rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                  isDark
                    ? "border-slate-600 text-slate-100 hover:bg-slate-800"
                    : "border-slate-300 text-slate-800 hover:bg-slate-50"
                }`}
              >
                {importing ? "Importing…" : "Import PDF or DOCX"}
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                      void importItinerary(file);
                      event.currentTarget.value = "";
                    }
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={loading || importing}
                className={`rounded-full px-5 py-2.5 text-sm font-medium text-white transition disabled:cursor-wait ${
                  isDark
                    ? "bg-teal-700 hover:bg-teal-600 disabled:bg-slate-600"
                    : "bg-slate-950 hover:bg-slate-800 disabled:bg-slate-500"
                }`}
              >
                {loading ? "Analysing…" : "Analyse itinerary"}
              </button>
            </form>
          </div>

          {error ? (
            <div className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          {loading && analysisProgress ? (
            <div
              className={`mt-4 rounded-[20px] border p-4 ${
                isDark ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className={`text-sm font-medium ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                    {analysisProgress.stage}
                  </p>
                  {analysisProgress.detail ? (
                    <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                      {analysisProgress.detail}
                    </p>
                  ) : null}
                </div>
                <p className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                  {analysisProgress.percent}%
                </p>
              </div>
              <div
                className={`mt-3 h-2 overflow-hidden rounded-full ${
                  isDark ? "bg-slate-800" : "bg-slate-200"
                }`}
              >
                <div
                  className="h-full rounded-full bg-teal-700 transition-[width] duration-300"
                  style={{ width: `${analysisProgress.percent}%` }}
                />
              </div>
            </div>
          ) : null}

          <p className={`mt-4 text-sm leading-6 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Upload a PDF, DOCX, DOC, or plain text itinerary and Gemini will convert it
            into structured stops for the visualizer.
          </p>
        </section>

        <section
          className={`mt-6 rounded-[32px] border p-5 shadow-[0_12px_40px_rgba(15,23,42,0.06)] ${
            isDark ? "border-white/10 bg-[#111827]" : "border-black/8 bg-white"
          }`}
        >
          <div className="mb-6">
            <p
              className={`text-xs font-medium uppercase tracking-[0.3em] ${
                isDark ? "text-slate-400" : "text-slate-500"
              }`}
            >
              Journey graph
            </p>
            <h2
              className={`mt-2 text-2xl font-semibold tracking-tight ${
                isDark ? "text-slate-50" : "text-slate-950"
              }`}
            >
              Add, delete, edit, and retrace routes here
            </h2>
          </div>

          <JourneyFlow
            key={[
              theme,
              stops.map((stop) => stop.id).join("|"),
              (journey?.legs ?? []).map((leg) => leg.id).join("|"),
            ].join("::")}
            stops={stops}
            legs={journey?.legs ?? []}
            selectedModes={selectedModes}
            theme={theme}
            onModeChange={(fromStopId, mode) =>
              setSelectedModes((current) => ({ ...current, [fromStopId]: mode }))
            }
            onUpdateStop={updateStop}
            onAddStop={addStop}
            onRemoveStop={removeStop}
            onReorder={reorderStops}
          />
        </section>

        <section
          className={`mt-6 rounded-[32px] border p-5 shadow-[0_12px_40px_rgba(15,23,42,0.06)] ${
            isDark ? "border-white/10 bg-[#111827]" : "border-black/8 bg-white"
          }`}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p
                className={`text-xs font-medium uppercase tracking-[0.3em] ${
                  isDark ? "text-slate-400" : "text-slate-500"
                }`}
              >
                Map
              </p>
              <h2
                className={`mt-2 text-2xl font-semibold tracking-tight ${
                  isDark ? "text-slate-50" : "text-slate-950"
                }`}
              >
                OpenStreetMap route view
              </h2>
            </div>
            <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {journey ? `${journey.legs.length} travel legs mapped` : "Analyse the trip to draw the route"}
            </p>
          </div>

          <OsmMap stops={journey?.stops ?? []} legs={journey?.legs ?? []} theme={theme} />
        </section>

        {journey?.limitations.length ? (
          <section
            className={`mt-6 rounded-[28px] border p-5 text-sm leading-6 ${
              isDark
                ? "border-[#4b5563] bg-[#172033] text-slate-300"
                : "border-[#d6c9b5] bg-[#f7efe1] text-slate-700"
            }`}
          >
            {journey.limitations.join(" ")}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function createId() {
  return Math.random().toString(36).slice(2, 10);
}
