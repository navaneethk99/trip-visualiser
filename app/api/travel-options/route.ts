import { NextRequest } from "next/server";

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
  sourceType: "public-web" | "distance-model" | "hybrid";
  evidence: string[];
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

type ScrapedInsight = {
  snippets: string[];
  links: string[];
};

const APP_USER_AGENT = "map-visualiser/0.1 (prototype travel planner)";
const GEOCODE_TIMEOUT_MS = 5000;
const SEARCH_TIMEOUT_MS = 4000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        send({
          type: "progress",
          percent: 5,
          stage: "Preparing itinerary",
        });

        const body = (await request.json()) as { stops?: StopInput[] };
        const incomingStops =
          body.stops?.filter((stop) => stop.place?.trim() && stop.datetime) ?? [];

        if (incomingStops.length < 2) {
          send({
            type: "error",
            error: "Add at least two itinerary stops with a place and date/time.",
          });
          controller.close();
          return;
        }

        const resolvedStops = await resolveStops(incomingStops, (current, total, place) => {
          send({
            type: "progress",
            percent: Math.round(10 + (current / total) * 40),
            stage: "Geocoding places",
            detail: place,
          });
        });

        const legs: JourneyLeg[] = [];
        const totalLegs = resolvedStops.length - 1;

        for (let index = 0; index < totalLegs; index += 1) {
          const from = resolvedStops[index];
          const to = resolvedStops[index + 1];

          send({
            type: "progress",
            percent: Math.round(52 + (index / totalLegs) * 28),
            stage: "Calculating distances",
            detail: `${shortenLocation(from.displayName)} to ${shortenLocation(to.displayName)}`,
          });

          const distanceKm = haversineKm(
            from.latitude,
            from.longitude,
            to.latitude,
            to.longitude,
          );

          send({
            type: "progress",
            percent: Math.round(64 + ((index + 1) / totalLegs) * 24),
            stage: "Comparing travel options",
            detail: `${shortenLocation(from.displayName)} to ${shortenLocation(to.displayName)}`,
          });

          const webInsight = await scrapeTravelInsights(from, to);
          const recommendations = inferTravelOptions(distanceKm, webInsight, from, to);

          legs.push({
            id: `${from.id}-${to.id}`,
            fromStopId: from.id,
            toStopId: to.id,
            from: shortenLocation(from.displayName),
            to: shortenLocation(to.displayName),
            originScheduledTime: from.datetime,
            recommendedDeparture: subtractHours(
              to.datetime,
              recommendations.fastest.durationHours,
            ),
            arrivalDeadline: to.datetime,
            distanceKm,
            fastest: recommendations.fastest,
            cheapest: recommendations.cheapest,
            options: recommendations.options,
            evidenceSources: [
              ...webInsight.snippets.slice(0, 3),
              ...webInsight.links.slice(0, 2).map((link) => `Source: ${link}`),
            ],
          });
        }

        send({
          type: "progress",
          percent: 96,
          stage: "Finalizing route",
        });

        send({
          type: "result",
          data: {
            stops: resolvedStops,
            legs,
            limitations: [
              "Fastest and cheapest results are inferred from public web snippets plus distance modelling, not from a booking engine.",
              "OpenStreetMap Nominatim geocoding is used with a low request rate; ambiguous place names may still resolve imperfectly.",
              "Ticket prices, schedules, and availability can change after the search date and should be confirmed before booking.",
            ],
          },
        });
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error ? error.message : "Unable to compute travel options.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function resolveStops(
  stops: StopInput[],
  onProgress?: (current: number, total: number, place: string) => void,
) {
  const cache = new Map<string, ResolvedStop>();
  const resolved: ResolvedStop[] = [];

  for (const [index, stop] of stops.entries()) {
    const key = stop.place.trim().toLowerCase();
    const cached = cache.get(key);

    onProgress?.(index + 1, stops.length, stop.place);

    if (cached) {
      resolved.push({ ...cached, id: stop.id, datetime: stop.datetime });
      continue;
    }

    const geocoded = await geocodeStop(stop.place);
    const entry: ResolvedStop = {
      id: stop.id,
      place: stop.place,
      datetime: stop.datetime,
      displayName: geocoded.displayName,
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
    };

    cache.set(key, entry);
    resolved.push(entry);
    await sleep(1100);
  }

  return resolved;
}

async function geocodeStop(place: string) {
  const nominatim = new URL("https://nominatim.openstreetmap.org/search");
  nominatim.searchParams.set("q", place);
  nominatim.searchParams.set("format", "jsonv2");
  nominatim.searchParams.set("limit", "1");

  const nominatimResult = await geocodeWithNominatim(nominatim);

  if (nominatimResult) {
    return nominatimResult;
  }

  const photon = new URL("https://photon.komoot.io/api/");
  photon.searchParams.set("q", place);
  photon.searchParams.set("limit", "1");

  const photonResult = await geocodeWithPhoton(photon);

  if (photonResult) {
    return photonResult;
  }

  throw new Error(
    `Geocoding failed for "${place}". Try choosing a suggestion from the dropdown or enter a more specific place like "Delhi, India".`,
  );
}

async function geocodeWithNominatim(endpoint: URL) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        headers: {
          "User-Agent": APP_USER_AGENT,
          "Accept-Language": "en",
        },
        cache: "no-store",
      }, GEOCODE_TIMEOUT_MS);

      if (response.ok) {
        const payload = (await response.json()) as Array<{
          display_name: string;
          lat: string;
          lon: string;
        }>;

        const best = payload[0];

        if (best) {
          return {
            displayName: best.display_name,
            latitude: Number(best.lat),
            longitude: Number(best.lon),
          };
        }
      }

      if (response.status !== 429 && response.status < 500) {
        break;
      }
    } catch {
      // Fall through to retry / fallback provider.
    }

    await sleep(600 * (attempt + 1));
  }

  return null;
}

async function geocodeWithPhoton(endpoint: URL) {
  try {
    const response = await fetchWithTimeout(endpoint, {
      headers: {
        "User-Agent": APP_USER_AGENT,
        "Accept-Language": "en",
      },
      cache: "no-store",
    }, GEOCODE_TIMEOUT_MS);

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      features?: Array<{
        geometry?: {
          coordinates?: [number, number];
        };
        properties?: {
          name?: string;
          city?: string;
          state?: string;
          country?: string;
        };
      }>;
    };

    const best = payload.features?.[0];
    const coordinates = best?.geometry?.coordinates;

    if (!best || !coordinates) {
      return null;
    }

    const displayParts = [
      best.properties?.name,
      best.properties?.city,
      best.properties?.state,
      best.properties?.country,
    ].filter(Boolean);

    return {
      displayName: displayParts.join(", "),
      latitude: coordinates[1],
      longitude: coordinates[0],
    };
  } catch {
    return null;
  }
}

async function scrapeTravelInsights(from: ResolvedStop, to: ResolvedStop): Promise<ScrapedInsight> {
  const searchTerms = [
    `fastest way to travel from ${from.place} to ${to.place}`,
    `cheapest way to travel from ${from.place} to ${to.place}`,
  ];

  const snippets = new Set<string>();
  const links = new Set<string>();

  for (const query of searchTerms) {
    const endpoint = new URL("https://html.duckduckgo.com/html/");
    endpoint.searchParams.set("q", query);

    try {
      const response = await fetchWithTimeout(endpoint, {
        headers: {
          "User-Agent": APP_USER_AGENT,
        },
        cache: "no-store",
      }, SEARCH_TIMEOUT_MS);

      if (!response.ok) {
        continue;
      }

      const html = await response.text();

      for (const snippet of extractMatches(
        html,
        /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
      )) {
        snippets.add(snippet);
      }

      for (const snippet of extractMatches(
        html,
        /<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
      )) {
        snippets.add(snippet);
      }

      for (const link of extractMatches(
        html,
        /<a[^>]*class="[^"]*result__url[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
      )) {
        links.add(link.replace(/\s+/g, ""));
      }
    } catch {
      continue;
    }
  }

  return {
    snippets: Array.from(snippets).slice(0, 5),
    links: Array.from(links).slice(0, 5),
  };
}

function extractMatches(html: string, pattern: RegExp) {
  const matches = Array.from(html.matchAll(pattern));

  return matches
    .map((match) => decodeHtml(stripTags(match[1] ?? "")))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function inferTravelOptions(
  distanceKm: number,
  insight: ScrapedInsight,
  from: ResolvedStop,
  to: ResolvedStop,
): { fastest: TravelOption; cheapest: TravelOption; options: TravelOption[] } {
  const text = insight.snippets.join(" ").toLowerCase();
  const modeScore = {
    flight: scoreMode(text, ["flight", "fly", "airline", "airport"]),
    train: scoreMode(text, ["train", "rail", "eurostar", "station"]),
    bus: scoreMode(text, ["bus", "coach", "flixbus"]),
    drive: scoreMode(text, ["drive", "car", "road trip", "taxi"]),
    ferry: scoreMode(text, ["ferry", "boat"]),
    walk: scoreMode(text, ["walk", "walking"]),
  };

  const modeProfiles = [
    buildMode("walk", 5, 0, modeScore.walk, distanceKm <= 8, 0.05, distanceKm),
    buildMode("bus", 65, 0.09, modeScore.bus, distanceKm <= 1200, 0.6, distanceKm),
    buildMode("train", 120, 0.13, modeScore.train, distanceKm <= 1800, 0.7, distanceKm),
    buildMode("drive", 78, 0.16, modeScore.drive, distanceKm <= 1600, 0.35, distanceKm),
    buildMode("ferry", 45, 0.12, modeScore.ferry, modeScore.ferry > 0, 1.4, distanceKm),
    buildMode(
      "flight",
      720,
      0.18,
      modeScore.flight,
      distanceKm >= 280,
      getFlightTerminalHours(distanceKm),
      distanceKm,
    ),
  ].filter((profile) => profile.available);

  const fastest = [...modeProfiles].sort((left, right) => {
    const leftRank = left.durationHours - left.signal * 0.08;
    const rightRank = right.durationHours - right.signal * 0.08;
    return leftRank - rightRank;
  })[0];

  const cheapest = [...modeProfiles].sort((left, right) => {
    const leftRank = left.estimatedCost - left.signal * 3;
    const rightRank = right.estimatedCost - right.signal * 3;
    return leftRank - rightRank;
  })[0];

  const options: TravelOption[] = modeProfiles
    .sort((left, right) => left.durationHours - right.durationHours)
    .map((mode) => ({
      mode: toTitle(mode.name),
      reason: buildReason("fastest", mode, insight, from, to),
      durationHours: mode.durationHours,
      estimatedCost: mode.estimatedCost,
      confidence: deriveConfidence(mode.signal, insight.snippets.length),
      sourceType: insight.snippets.length ? "hybrid" : "distance-model",
      evidence: insight.snippets,
    }));

  return {
    fastest: {
      mode: toTitle(fastest.name),
      reason: buildReason("fastest", fastest, insight, from, to),
      durationHours: fastest.durationHours,
      estimatedCost: fastest.estimatedCost,
      confidence: deriveConfidence(fastest.signal, insight.snippets.length),
      sourceType: insight.snippets.length ? "hybrid" : "distance-model",
      evidence: insight.snippets,
    },
    cheapest: {
      mode: toTitle(cheapest.name),
      reason: buildReason("cheapest", cheapest, insight, from, to),
      durationHours: cheapest.durationHours,
      estimatedCost: cheapest.estimatedCost,
      confidence: deriveConfidence(cheapest.signal, insight.snippets.length),
      sourceType: insight.snippets.length ? "hybrid" : "distance-model",
      evidence: insight.snippets,
    },
    options,
  };
}

function buildMode(
  name: string,
  speedKmh: number,
  costPerKm: number,
  signal: number,
  available: boolean,
  terminalHours: number,
  distanceKm: number,
) {
  return {
    name,
    available,
    signal,
    durationHours: terminalHours + distanceKm / speedKmh,
    estimatedCost:
      name === "walk"
        ? 0
        : Math.max(distanceKm * costPerKm + terminalHours * 12, 12),
    speedKmh,
    terminalHours,
  };
}

function buildReason(
  type: "fastest" | "cheapest",
  mode: ReturnType<typeof buildMode>,
  insight: ScrapedInsight,
  from: ResolvedStop,
  to: ResolvedStop,
) {
  const quotedEvidence = insight.snippets[0];
  const sourceLead = quotedEvidence
    ? `Public search snippets mention ${toTitle(mode.name).toLowerCase()}-related options on this route.`
    : "No strong web snippet was available, so the result falls back to distance-based travel modelling.";

  const conclusion =
    type === "fastest"
      ? `${toTitle(mode.name)} is projected to minimise total journey time from ${shortenLocation(from.displayName)} to ${shortenLocation(to.displayName)}.`
      : `${toTitle(mode.name)} is projected to minimise estimated spend on this leg.`;

  const overheadNote =
    mode.name === "flight"
      ? " Flight timing includes airport arrival, check-in, security, boarding, and exit time, not just in-air time."
      : "";

  return `${sourceLead} ${conclusion}${overheadNote}`;
}

function deriveConfidence(
  signal: number,
  snippetCount: number,
): TravelOption["confidence"] {
  if (signal >= 2 || snippetCount >= 3) {
    return "high";
  }

  if (signal >= 1 || snippetCount >= 1) {
    return "medium";
  }

  return "low";
}

function scoreMode(text: string, keywords: string[]) {
  return keywords.reduce(
    (total, keyword) => total + (text.includes(keyword) ? 1 : 0),
    0,
  );
}

function toTitle(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shortenLocation(displayName: string) {
  return displayName.split(",").slice(0, 2).join(",").trim();
}

function haversineKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const startLatitude = toRadians(latitudeA);
  const endLatitude = toRadians(latitudeB);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getFlightTerminalHours(distanceKm: number) {
  if (distanceKm < 700) {
    return 2.8;
  }

  if (distanceKm < 2500) {
    return 3.2;
  }

  return 3.8;
}

async function fetchWithTimeout(
  input: URL | string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function subtractHours(value: string, hours: number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setTime(date.getTime() - hours * 60 * 60 * 1000);
  return date.toISOString();
}
