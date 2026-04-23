import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

type GeminiStop = {
  place: string;
  datetime: string;
};

export async function POST(request: Request) {
  try {
    if (!GEMINI_API_KEY) {
      return Response.json(
        {
          error:
            "Set GEMINI_API_KEY in the environment before importing itinerary files.",
        },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Upload a file first." }, { status: 400 });
    }

    const extractedText = await extractTextFromFile(file);

    if (!extractedText.trim()) {
      return Response.json(
        { error: "The uploaded file did not contain readable itinerary text." },
        { status: 400 },
      );
    }

    const imported = await convertTextToStopsWithGemini(extractedText, file.name);

    if (imported.length < 2) {
      return Response.json(
        { error: "Gemini could not extract at least two usable itinerary stops." },
        { status: 400 },
      );
    }

    return Response.json({
      stops: imported,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to import itinerary file.",
      },
      { status: 500 },
    );
  }
}

async function extractTextFromFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();
  const mimeType = file.type;

  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    PDFParse.setWorker(
      pathToFileURL(
        path.join(
          process.cwd(),
          "node_modules",
          "pdf-parse",
          "dist",
          "pdf-parse",
          "esm",
          "pdf.worker.mjs",
        ),
      ).href,
    );
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy();
    return parsed.text;
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value;
  }

  if (mimeType === "application/msword" || fileName.endsWith(".doc")) {
    return buffer.toString("utf8");
  }

  if (mimeType.startsWith("text/") || fileName.endsWith(".txt")) {
    return buffer.toString("utf8");
  }

  throw new Error("Unsupported file type. Use PDF, DOCX, DOC, or plain text.");
}

async function convertTextToStopsWithGemini(text: string, fileName: string) {
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
  );
  endpoint.searchParams.set("key", GEMINI_API_KEY as string);

  const prompt = [
    "You convert itinerary documents into JSON for a travel visualizer.",
    "Return only valid JSON. Do not wrap in markdown.",
    "The JSON schema must be:",
    '{"stops":[{"place":"string","datetime":"YYYY-MM-DDTHH:mm"}]}',
    "Rules:",
    "- Extract stops in chronological order.",
    "- Each stop must include a place and a local datetime.",
    "- Normalize datetimes to the format YYYY-MM-DDTHH:mm.",
    "- If the source omits minutes, use :00.",
    "- If a stop has a date but no time, infer a reasonable daytime default and still output a valid datetime.",
    "- Exclude hotel check-in notes or commentary unless they are actual itinerary stops.",
    "- Do not create separate stops for cafes, restaurants, bars, shops, museums, attractions, or other venue-level sublocations when they are just activities within the same broader place.",
    "- Prefer the containing area or destination that matters for mapping, such as the city, neighborhood, landmark area, airport, train station, or town.",
    "- If the itinerary says something like breakfast at a cafe in Paris, keep the stop as Paris unless the document clearly indicates a different travel location.",
    "- Only output a new stop when the traveler is actually moving to a different place relevant to route visualization.",
    "- Avoid repetition. If multiple consecutive itinerary items happen in the same broader place, output that place only once for that time block instead of repeating it.",
    "- Do not emit duplicate consecutive stops such as Vienna, Vienna, Vienna unless the document clearly shows the traveler left Vienna and later returned.",
    `Source file name: ${fileName}`,
    "Source text:",
    text.slice(0, 32000),
  ].join("\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gemini import failed: ${message}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const rawText =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? "";

  const parsed = JSON.parse(stripCodeFences(rawText)) as { stops?: GeminiStop[] };

  return (parsed.stops ?? [])
    .filter((stop) => stop.place?.trim() && stop.datetime?.trim())
    .map((stop) => ({
      place: stop.place.trim(),
      datetime: normaliseDatetime(stop.datetime.trim()),
    }))
    .filter((stop) => stop.datetime.length > 0)
    .reduce<Array<{ place: string; datetime: string }>>((accumulator, stop) => {
      const previous = accumulator[accumulator.length - 1];

      if (previous && broaderPlaceKey(previous.place) === broaderPlaceKey(stop.place)) {
        if (stop.datetime < previous.datetime) {
          previous.datetime = stop.datetime;
        }

        return accumulator;
      }

      accumulator.push(stop);
      return accumulator;
    }, []);
}

function stripCodeFences(value: string) {
  return value.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

function normaliseDatetime(value: string) {
  const compact = value.replace(" ", "T");
  const date = new Date(compact);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function broaderPlaceKey(value: string) {
  return value
    .toLowerCase()
    .split(",")[0]
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
