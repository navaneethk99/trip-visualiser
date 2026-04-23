"use client";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  createContext,
  useContext,
  useMemo,
} from "react";
import PlaceAutocomplete from "./place-autocomplete";

type StopInput = {
  id: string;
  place: string;
  datetime: string;
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
  recommendedDeparture: string;
  arrivalDeadline: string;
  distanceKm: number;
  fastest: TravelOption;
  cheapest: TravelOption;
  options: TravelOption[];
};

type StopNodeData = {
  stopId: string;
  subtitle: string;
};

type JourneyFlowContextValue = {
  stopMap: Map<string, StopInput>;
  legMap: Map<string, JourneyLeg>;
  selectedModes: Record<string, string>;
  theme: "light" | "dark";
  onModeChange: (fromStopId: string, mode: string) => void;
  onUpdateStop: (id: string, field: "place" | "datetime", value: string) => void;
  onRemoveStop: (id: string) => void;
  totalStops: number;
};

const JourneyFlowContext = createContext<JourneyFlowContextValue | null>(null);

const nodeTypes = {
  itineraryStop: StopNode,
};

export default function JourneyFlow({
  stops,
  legs,
  selectedModes,
  theme,
  onModeChange,
  onUpdateStop,
  onAddStop,
  onRemoveStop,
  onReorder,
}: {
  stops: StopInput[];
  legs: JourneyLeg[];
  selectedModes: Record<string, string>;
  theme: "light" | "dark";
  onModeChange: (fromStopId: string, mode: string) => void;
  onUpdateStop: (id: string, field: "place" | "datetime", value: string) => void;
  onAddStop: () => void;
  onRemoveStop: (id: string) => void;
  onReorder: (ids: string[]) => Promise<void> | void;
}) {
  return (
    <ReactFlowProvider>
      <JourneyFlowCanvas
        stops={stops}
        legs={legs}
        selectedModes={selectedModes}
        theme={theme}
        onModeChange={onModeChange}
        onUpdateStop={onUpdateStop}
        onAddStop={onAddStop}
        onRemoveStop={onRemoveStop}
        onReorder={onReorder}
      />
    </ReactFlowProvider>
  );
}

function JourneyFlowCanvas({
  stops,
  legs,
  selectedModes,
  theme,
  onModeChange,
  onUpdateStop,
  onAddStop,
  onRemoveStop,
  onReorder,
}: {
  stops: StopInput[];
  legs: JourneyLeg[];
  selectedModes: Record<string, string>;
  theme: "light" | "dark";
  onModeChange: (fromStopId: string, mode: string) => void;
  onUpdateStop: (id: string, field: "place" | "datetime", value: string) => void;
  onAddStop: () => void;
  onRemoveStop: (id: string) => void;
  onReorder: (ids: string[]) => Promise<void> | void;
}) {
  const isDark = theme === "dark";
  const contextValue = useMemo<JourneyFlowContextValue>(
    () => ({
      stopMap: new Map(stops.map((stop) => [stop.id, stop])),
      legMap: new Map(legs.map((leg) => [leg.fromStopId, leg])),
      selectedModes,
      theme,
      onModeChange,
      onUpdateStop,
      onRemoveStop,
      totalStops: stops.length,
    }),
    [legs, onModeChange, onRemoveStop, onUpdateStop, selectedModes, stops, theme],
  );

  const initialNodes = useMemo<Node<StopNodeData>[]>(
    () =>
      stops.map((stop, index) => {
        return {
          id: stop.id,
          type: "itineraryStop",
          position: {
            x: index * 360,
            y: 60 + (index % 2) * 140,
          },
          draggable: true,
          data: {
            stopId: stop.id,
            subtitle: `Stop ${index + 1}`,
          },
        };
      }),
    [stops],
  );
  const [nodes, , onNodesChange] = useNodesState(initialNodes);

  const edges = useMemo<Edge[]>(
    () =>
      legs.map((leg) => {
        const selectedOption =
          leg.options.find(
            (option) => option.mode === (selectedModes[leg.fromStopId] ?? leg.fastest.mode),
          ) ?? leg.fastest;

        return {
          id: leg.id,
          source: leg.fromStopId,
          target: leg.toStopId,
          type: "smoothstep",
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isDark ? "#66d9b8" : "#0f766e",
          },
          style: {
            stroke: isDark ? "#66d9b8" : "#0f766e",
            strokeWidth: 3,
          },
          label: `${selectedOption.mode} · ${selectedOption.durationHours.toFixed(1)}h · leave ${formatDate(
            subtractHours(leg.arrivalDeadline, selectedOption.durationHours),
          )}`,
          labelStyle: {
            fill: isDark ? "#d7e4ef" : "#0f172a",
            fontSize: 12,
            fontWeight: 500,
          },
          labelBgStyle: {
            fill: isDark ? "#11161d" : "#ffffff",
            fillOpacity: 0.96,
          },
          labelBgPadding: [8, 5],
          labelBgBorderRadius: 8,
        } satisfies Edge;
      }),
    [isDark, legs, selectedModes],
  );

  async function handleNodeDragStop() {
    const orderedIds = [...nodes]
      .sort((left, right) => left.position.x - right.position.x)
      .map((node) => node.id);

    const currentIds = stops.map((stop) => stop.id);

    if (orderedIds.join("|") !== currentIds.join("|")) {
      await onReorder(orderedIds);
    }
  }

  return (
    <JourneyFlowContext.Provider value={contextValue}>
      <div
        className={`overflow-hidden rounded-[28px] border ${
          isDark ? "border-black/40 bg-[#11161d]" : "border-slate-200 bg-[#f8fafc]"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b px-5 py-4 ${
            isDark ? "border-white/8" : "border-slate-200"
          }`}
        >
          <div>
            <p className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-900"}`}>
              Route graph editor
            </p>
            <p className={`text-sm ${isDark ? "text-slate-500" : "text-slate-600"}`}>
              Edit stops directly on the nodes, drag them to retrace the route.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddStop}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              isDark
                ? "border-slate-600 text-slate-100 hover:bg-white/5"
                : "border-slate-300 text-slate-900 hover:bg-slate-100"
            }`}
          >
            Add stop
          </button>
        </div>
        <div className="h-[560px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            fitViewOptions={{ padding: 0.2, maxZoom: 1.05 }}
            onNodesChange={onNodesChange}
            onNodeDragStop={() => {
              void handleNodeDragStop();
            }}
            onInit={(instance) => {
              window.setTimeout(() => {
                void instance.fitView({ duration: 350, padding: 0.2, maxZoom: 1.05 });
              }, 0);
            }}
            fitView
            minZoom={0.4}
            maxZoom={1.3}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ zIndex: 1 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            panOnDrag
          >
            <Background color={isDark ? "#202833" : "#d9e2ec"} gap={24} />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </JourneyFlowContext.Provider>
  );
}

function StopNode({ data }: NodeProps<Node<StopNodeData>>) {
  const context = useContext(JourneyFlowContext);

  if (!context) {
    return null;
  }

  const stop = context.stopMap.get(data.stopId);
  const outgoingLeg = context.legMap.get(data.stopId);

  if (!stop) {
    return null;
  }

  const isDark = context.theme === "dark";

  return (
    <div
      className={`relative min-w-[330px] rounded-[18px] border shadow-[0_18px_36px_rgba(0,0,0,0.28)] ${
        isDark
          ? "border-black/70 bg-[#2b3138] text-slate-100"
          : "border-slate-300 bg-white text-slate-900"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={`!h-4 !w-4 !border-2 ${isDark ? "!border-[#11161d] !bg-[#79d4ff]" : "!border-white !bg-[#2563eb]"}`}
      />

      <div className={`rounded-t-[18px] px-4 py-3 ${isDark ? "bg-[#3f8458]" : "bg-[#dbeafe]"}`}>
        <div className="flex items-center justify-between gap-3">
          <span
            className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.18em] ${
              isDark ? "bg-black/15 text-white/80" : "bg-white/80 text-slate-700"
            }`}
          >
            {data.subtitle}
          </span>
          {context.totalStops > 2 ? (
            <button
              type="button"
              onClick={() => context.onRemoveStop(data.stopId)}
              className={`text-sm transition ${isDark ? "text-white/80 hover:text-white" : "text-slate-600 hover:text-slate-900"}`}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        <PlaceAutocomplete
          value={stop.place}
          onChange={(value) => context.onUpdateStop(data.stopId, "place", value)}
          theme={context.theme}
        />
        <label className="block">
          <span
            className={`mb-2 block text-[11px] uppercase tracking-[0.22em] ${
              isDark ? "text-slate-500" : "text-slate-500"
            }`}
          >
            Time you want to be here
          </span>
          <input
            type="datetime-local"
            value={stop.datetime}
            onChange={(event) =>
              context.onUpdateStop(data.stopId, "datetime", event.target.value)
            }
            className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${
              isDark
                ? "border-slate-600 bg-[#1a1f26] text-slate-100"
                : "border-slate-300 bg-white text-slate-900"
            }`}
          />
        </label>
        {outgoingLeg ? (
          <label className="block">
            <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Outgoing mode
            </span>
            <select
              value={context.selectedModes[data.stopId] ?? outgoingLeg.fastest.mode}
              onChange={(event) => context.onModeChange(data.stopId, event.target.value)}
              className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${
                isDark
                  ? "border-slate-600 bg-[#1a1f26] text-slate-100"
                  : "border-slate-300 bg-white text-slate-900"
              }`}
            >
              {outgoingLeg.options.map((option) => (
                <option key={option.mode} value={option.mode}>
                  {option.mode}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
          Drag horizontally to reorder
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className={`!h-4 !w-4 !border-2 ${isDark ? "!border-[#11161d] !bg-[#7ef0a7]" : "!border-white !bg-[#16a34a]"}`}
      />
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function subtractHours(value: string, hours: number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setTime(date.getTime() - hours * 60 * 60 * 1000);
  return date.toISOString();
}
