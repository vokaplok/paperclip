import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Users,
} from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { useToastActions } from "../context/ToastContext";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { heartbeatsApi } from "../api/heartbeats";
import { SIDEBAR_SCROLL_RESET_STATE } from "../lib/navigation-scroll";
import { queryKeys } from "../lib/queryKeys";
import { cn, agentRouteRef, agentUrl } from "../lib/utils";
import { useAgentOrder } from "../hooks/useAgentOrder";
import {
  AGENT_SORT_MODE_UPDATED_EVENT,
  getAgentSortModeStorageKey,
  readAgentSortMode,
  type AgentSortModeUpdatedDetail,
  type AgentSidebarSortMode,
  writeAgentSortMode,
} from "../lib/agent-order";
import { AgentIcon } from "./AgentIconPicker";
import { BudgetSidebarMarker } from "./BudgetSidebarMarker";
import { SidebarSection, type SidebarSectionRadioChoice } from "./SidebarSection";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Agent } from "@paperclipai/shared";

const AGENT_SORT_CHOICES: SidebarSectionRadioChoice[] = [
  { value: "top", label: "Top" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "recent", label: "Recent" },
];

function agentTimestamp(agent: Agent, field: "lastHeartbeatAt" | "updatedAt" | "createdAt"): number {
  const raw = agent[field];
  if (!raw) return 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortAgents(agents: Agent[], sortMode: AgentSidebarSortMode): Agent[] {
  if (sortMode === "top") return agents;
  const sorted = [...agents];
  if (sortMode === "alphabetical") {
    sorted.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    return sorted;
  }
  sorted.sort((left, right) => {
    const heartbeatDiff = agentTimestamp(right, "lastHeartbeatAt") - agentTimestamp(left, "lastHeartbeatAt");
    if (heartbeatDiff !== 0) return heartbeatDiff;

    const updatedDiff = agentTimestamp(right, "updatedAt") - agentTimestamp(left, "updatedAt");
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff = agentTimestamp(right, "createdAt") - agentTimestamp(left, "createdAt");
    return createdDiff !== 0
      ? createdDiff
      : left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  return sorted;
}

function shortModelLabel(model: string): string {
  const withoutProvider = model.includes("/") ? (model.split("/").at(-1) ?? model) : model;
  return withoutProvider.replace(/^claude-/, "");
}

function AgentModelBadge({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"list" | "confirm">("list");
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();

  const currentModel = typeof agent.adapterConfig.model === "string"
    ? agent.adapterConfig.model
    : null;

  const { data: models = [], isLoading } = useQuery({
    queryKey: ["adapterModels", agent.companyId, agent.adapterType],
    queryFn: () => agentsApi.adapterModels(agent.companyId, agent.adapterType),
    enabled: open,
    staleTime: 30_000,
  });

  const updateModel = useMutation({
    mutationFn: (modelId: string) =>
      agentsApi.update(agent.id, {
        adapterConfig: { ...agent.adapterConfig, model: modelId },
      }, agent.companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(agent.companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
      setPhase("confirm");
    },
    onError: () => {
      pushToast({ title: "Failed to update model", tone: "error" });
    },
  });

  const resetSession = useMutation({
    mutationFn: () => agentsApi.resetSession(agent.id, null, agent.companyId),
    onSuccess: () => {
      pushToast({ title: "Session restarted", tone: "success" });
      setOpen(false);
    },
    onError: () => {
      pushToast({ title: "Failed to restart session", tone: "error" });
    },
  });

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setPhase("list");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/60 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label={currentModel ? `Model: ${currentModel}. Click to switch.` : "Using default model. Click to set."}
        >
          {currentModel ? shortModelLabel(currentModel) : "default"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end" side="right">
        {phase === "list" ? (
          <>
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
              Switch model
            </p>
            {isLoading ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">Loading…</p>
            ) : models.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No models available</p>
            ) : (
              models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="flex items-center w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 gap-2 disabled:opacity-50"
                  onClick={() => updateModel.mutate(m.id)}
                  disabled={updateModel.isPending || m.id === currentModel}
                >
                  <span className="flex-1 text-left truncate font-mono">{m.label}</span>
                  {m.id === currentModel && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 shrink-0">
                      current
                    </span>
                  )}
                </button>
              ))
            )}
          </>
        ) : (
          <div className="p-2 space-y-2">
            <p className="text-xs font-medium text-foreground">Model updated</p>
            <p className="text-[11px] text-muted-foreground">
              Applies on next session. Restart now?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 text-xs px-2 py-1 rounded border border-border hover:bg-accent/50 transition-colors"
                onClick={() => setOpen(false)}
              >
                Later
              </button>
              <button
                type="button"
                className="flex-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={() => resetSession.mutate()}
                disabled={resetSession.isPending}
              >
                {resetSession.isPending ? "Restarting…" : "Restart now"}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SidebarAgentItem({
  activeAgentId,
  activeTab,
  agent,
  disabled,
  isMobile,
  onPauseResume,
  runCount,
  setSidebarOpen,
}: {
  activeAgentId: string | null;
  activeTab: string | null;
  agent: Agent;
  disabled: boolean;
  isMobile: boolean;
  onPauseResume: (agent: Agent, action: "pause" | "resume") => void;
  runCount: number;
  setSidebarOpen: (open: boolean) => void;
}) {
  const routeRef = agentRouteRef(agent);
  const href = activeTab ? `${agentUrl(agent)}/${activeTab}` : agentUrl(agent);
  const editHref = `${agentUrl(agent)}/configuration`;
  const isActive = activeAgentId === routeRef;
  const isPaused = agent.status === "paused";
  const isBudgetPaused = isPaused && agent.pauseReason === "budget";
  const pauseResumeLabel = isPaused ? "Resume agent" : "Pause agent";
  const pauseResumeDisabled = disabled || agent.status === "pending_approval" || isBudgetPaused;
  const pauseResumeDisabledLabel = disabled
    ? "Updating..."
    : isBudgetPaused
      ? "Budget paused"
      : pauseResumeLabel;

  return (
    <div className="group/agent relative flex items-center">
      <NavLink
        to={href}
        state={SIDEBAR_SCROLL_RESET_STATE}
        onClick={() => {
          if (isMobile) setSidebarOpen(false);
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 pointer-coarse:py-1 pr-8 text-[13px] font-medium transition-colors",
          isActive
            ? "bg-accent text-foreground"
            : "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <AgentIcon icon={agent.icon} className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 min-w-0 flex items-center gap-1">
          <span className="truncate min-w-0">{agent.name}</span>
          <AgentModelBadge agent={agent} />
        </span>
        {(agent.pauseReason === "budget" || runCount > 0) && (
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {agent.pauseReason === "budget" ? (
              <BudgetSidebarMarker title="Agent paused by budget" />
            ) : null}
            {runCount > 0 ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
            ) : null}
            {runCount > 0 ? (
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                {runCount} live
              </span>
            ) : null}
          </span>
        )}
      </NavLink>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 transition-opacity data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
              isMobile
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover/agent:pointer-events-auto group-hover/agent:opacity-100 group-focus-within/agent:pointer-events-auto group-focus-within/agent:opacity-100",
            )}
            aria-label={`Open actions for ${agent.name}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link
              to={editHref}
              onClick={() => {
                if (isMobile) setSidebarOpen(false);
              }}
            >
              <Pencil className="size-4" />
              <span>Edit agent</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              if (pauseResumeDisabled) return;
              onPauseResume(agent, isPaused ? "resume" : "pause");
            }}
            disabled={pauseResumeDisabled}
            title={isBudgetPaused ? "Agent was paused by budget limits" : undefined}
          >
            {isPaused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
            <span>{pauseResumeDisabledLabel}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SidebarAgents() {
  const [open, setOpen] = useState(true);
  const [pendingAgentIds, setPendingAgentIds] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialogActions();
  const { isMobile, setSidebarOpen } = useSidebar();
  const { pushToast } = useToastActions();
  const location = useLocation();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);

  const visibleAgents = useMemo(() => {
    const filtered = (agents ?? []).filter(
      (a: Agent) => a.status !== "terminated"
    );
    return filtered;
  }, [agents]);
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const sortModeStorageKey = useMemo(() => {
    if (!selectedCompanyId) return null;
    return getAgentSortModeStorageKey(selectedCompanyId, currentUserId);
  }, [currentUserId, selectedCompanyId]);
  const [sortMode, setSortMode] = useState<AgentSidebarSortMode>(() => {
    if (!sortModeStorageKey) return "top";
    return readAgentSortMode(sortModeStorageKey);
  });
  const { orderedAgents } = useAgentOrder({
    agents: visibleAgents,
    companyId: selectedCompanyId,
    userId: currentUserId,
  });
  const sortedAgents = useMemo(
    () => sortAgents(orderedAgents, sortMode),
    [orderedAgents, sortMode],
  );

  const agentMatch = location.pathname.match(/^\/(?:[^/]+\/)?agents\/([^/]+)(?:\/([^/]+))?/);
  const activeAgentId = agentMatch?.[1] ?? null;
  const activeTab = agentMatch?.[2] ?? null;

  useEffect(() => {
    if (!sortModeStorageKey) {
      setSortMode("top");
      return;
    }
    setSortMode(readAgentSortMode(sortModeStorageKey));
  }, [sortModeStorageKey]);

  useEffect(() => {
    if (!sortModeStorageKey) return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== sortModeStorageKey) return;
      setSortMode(readAgentSortMode(sortModeStorageKey));
    };
    const onCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<AgentSortModeUpdatedDetail>).detail;
      if (!detail || detail.storageKey !== sortModeStorageKey) return;
      setSortMode(detail.sortMode);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(AGENT_SORT_MODE_UPDATED_EVENT, onCustomEvent);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AGENT_SORT_MODE_UPDATED_EVENT, onCustomEvent);
    };
  }, [sortModeStorageKey]);

  const persistSortMode = useCallback(
    (value: string) => {
      const nextSortMode: AgentSidebarSortMode =
        value === "alphabetical" || value === "recent" ? value : "top";
      setSortMode(nextSortMode);
      if (sortModeStorageKey) {
        writeAgentSortMode(sortModeStorageKey, nextSortMode);
      }
    },
    [sortModeStorageKey],
  );

  const pauseResumeAgent = useMutation({
    mutationFn: ({ agent, action }: { agent: Agent; action: "pause" | "resume" }) =>
      action === "pause"
        ? agentsApi.pause(agent.id, selectedCompanyId ?? undefined)
        : agentsApi.resume(agent.id, selectedCompanyId ?? undefined),
    onMutate: ({ agent }) => {
      setPendingAgentIds((current) => {
        const next = new Set(current);
        next.add(agent.id);
        return next;
      });
    },
    onSuccess: async (_agent, { agent, action }) => {
      if (selectedCompanyId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(selectedCompanyId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) }),
        ]);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentRouteRef(agent)) }),
      ]);
      pushToast({
        title: action === "pause" ? "Agent paused" : "Agent resumed",
        body: agent.name,
        tone: "success",
      });
    },
    onError: (error, { agent, action }) => {
      pushToast({
        title: action === "pause" ? "Could not pause agent" : "Could not resume agent",
        body: error instanceof Error ? error.message : agent.name,
        tone: "error",
      });
    },
    onSettled: (_data, _error, { agent }) => {
      setPendingAgentIds((current) => {
        const next = new Set(current);
        next.delete(agent.id);
        return next;
      });
    },
  });

  return (
    <SidebarSection
      label="Agents"
      collapsible={{ open, onOpenChange: setOpen }}
      headerAction={{
        ariaLabel: "New agent",
        icon: Plus,
        onClick: openNewAgent,
      }}
      menu={{
        ariaLabel: "Agents section actions",
        actions: [
          { type: "item", label: "Browse agents", icon: Users, href: "/agents/all" },
          { type: "separator" },
        ],
        radioLabel: "Agent sort",
        radioChoices: AGENT_SORT_CHOICES,
        radioValue: sortMode,
        onRadioValueChange: persistSortMode,
      }}
    >
      {sortedAgents.map((agent: Agent) => {
        const runCount = liveCountByAgent.get(agent.id) ?? 0;
        return (
          <SidebarAgentItem
            key={agent.id}
            activeAgentId={activeAgentId}
            activeTab={activeTab}
            agent={agent}
            disabled={pendingAgentIds.has(agent.id)}
            isMobile={isMobile}
            onPauseResume={(targetAgent, action) => pauseResumeAgent.mutate({ agent: targetAgent, action })}
            runCount={runCount}
            setSidebarOpen={setSidebarOpen}
          />
        );
      })}
    </SidebarSection>
  );
}
