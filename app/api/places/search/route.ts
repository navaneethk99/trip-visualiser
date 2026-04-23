import { NextRequest } from "next/server";

const APP_USER_AGENT = "map-visualiser/0.1 (prototype travel planner)";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return Response.json({ suggestions: [] });
  }

  const suggestions = await searchNominatim(query);

  if (suggestions.length > 0) {
    return Response.json({ suggestions });
  }

  return Response.json({ suggestions: await searchPhoton(query) }, { status: 200 });
}

async function searchNominatim(query: string) {
  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("limit", "5");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": APP_USER_AGENT,
          "Accept-Language": "en",
        },
        cache: "no-store",
      });

      if (response.ok) {
        const payload = (await response.json()) as Array<{
          place_id: number;
          display_name: string;
          lat: string;
          lon: string;
        }>;

        return payload.map((item) => ({
          id: item.place_id,
          label: item.display_name,
          latitude: Number(item.lat),
          longitude: Number(item.lon),
        }));
      }

      if (response.status !== 429 && response.status < 500) {
        break;
      }
    } catch {
      // Fall through to retry / fallback provider.
    }

    await sleep(350 * (attempt + 1));
  }

  return [];
}

async function searchPhoton(query: string) {
  const endpoint = new URL("https://photon.komoot.io/api/");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("limit", "5");

  try {
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": APP_USER_AGENT,
        "Accept-Language": "en",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      features?: Array<{
        properties?: {
          osm_id?: number;
          name?: string;
          city?: string;
          state?: string;
          country?: string;
        };
        geometry?: {
          coordinates?: [number, number];
        };
      }>;
    };

    return (payload.features ?? [])
      .filter((feature) => feature.geometry?.coordinates)
      .map((feature, index) => {
        const parts = [
          feature.properties?.name,
          feature.properties?.city,
          feature.properties?.state,
          feature.properties?.country,
        ].filter(Boolean);
        const coordinates = feature.geometry?.coordinates as [number, number];

        return {
          id: feature.properties?.osm_id ?? index,
          label: parts.join(", "),
          latitude: coordinates[1],
          longitude: coordinates[0],
        };
      });
  } catch {
    return [];
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
