'use client';

import { useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { useSafeAuth } from '../hooks/useSafeClerk';
import CompanionAgentSummary from '../components/CompanionAgentSummary';
import {
  deriveAgentSyncStateFromInventory,
} from '@/lib/companion-agent-display';

type MachineSummary = {
  id: string;
  machineName: string;
  platform: string;
  status: string;
  configMode: string;
  companionVersion: string | null;
  openclawVersion: string | null;
  lastSeenAt: string | null;
  lastInventoryHash: string | null;
  activeConfigHash: string | null;
  openclawReachable: boolean | null;
  plotterHealthy: boolean | null;
  pendingOperationCount: number;
  runtimeState: {
    lastDesiredSyncAt: string | null;
    lastInventoryUploadedAt: string | null;
    lastMemoryUploadedAt: string | null;
    lastApplyStartedAt: string | null;
    lastApplyCompletedAt: string | null;
    lastReconciledAt: string | null;
    lastAppliedDesiredConfigVersion: number | null;
    lastAppliedManagedFragmentPath: string | null;
    lastAppliedManagedFragmentHash: string | null;
    driftDetected: boolean | null;
    driftReason: string | null;
    lastMemorySyncSummary: {
      receivedAgents: number;
      syncedAgents: number;
      syncedFiles: number;
      syncedRuntimeKeys: number;
    } | null;
  };
  counts: {
    agents: number;
    operations: number;
    inventories: number;
  };
};

type MachineDetail = {
  id: string;
  machineName: string;
  latestInventory: any;
  agents: Array<{
    id: string;
    name: string;
    openclawAgentId: string;
    ownership: string;
    model: string | null;
    workspacePath: string | null;
    ekybotAgentId?: string | null;
    projectId?: string | null;
    channelKey?: string | null;
    ekybotAgent?: {
      id: string;
      name: string;
      provider: string;
      model: string;
      projectId: string | null;
    } | null;
    project?: {
      id: string;
      name: string;
      slug: string;
    } | null;
    channel?: {
      id: string;
      name: string;
      key: string;
    } | null;
  }>;
};

type Operation = {
  id: string;
  type: string;
  status: string;
  requestedAt: string;
  appliedAt?: string | null;
  error?: string | null;
  payload: Record<string, unknown>;
};

type RegistrationTokenRecord = {
  id: string;
  label: string;
  expiresAt: string;
  createdAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
};

type ImportCandidate = {
  id: string;
  openclawAgentId: string;
  name: string;
  ownership: string;
  classification: string;
  model: string | null;
  workspacePath: string | null;
  warnings: string[];
  recommendedAction: string;
  suggestedMapping: {
    projectId: string | null;
    channelId: string | null;
    channelKey: string | null;
    createProjectName: string | null;
    createChannelName: string | null;
    createChannelKey: string | null;
  };
};

type ProjectOption = {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
};

type ChannelOption = {
  id: string;
  name: string;
  key: string;
  projectId: string | null;
  agentId: string | null;
};

type ImportMappingState = {
  projectId: string;
  channelId: string;
  channelKey: string;
  createProjectName: string;
  createChannelName: string;
  createChannelKey: string;
};

export default function CompanionPage() {
  const companionAppUrl = 'https://www.ekybot.com';
  const { isLoaded, isSignedIn, getToken } = useSafeAuth();
  const [machines, setMachines] = useState<MachineSummary[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [machineDetail, setMachineDetail] = useState<MachineDetail | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [importMappings, setImportMappings] = useState<Record<string, ImportMappingState>>({});
  const [registrationTokens, setRegistrationTokens] = useState<RegistrationTokenRecord[]>([]);
  const [freshRegistrationToken, setFreshRegistrationToken] = useState<string | null>(null);
  const [revokingTokenIds, setRevokingTokenIds] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importingAgentIds, setImportingAgentIds] = useState<string[]>([]);
  const [deletingAgentIds, setDeletingAgentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function getRegistrationTokenState(token: RegistrationTokenRecord) {
    if (token.revokedAt) {
      return {
        label: 'revoked',
        tone: 'bg-red-500/20 text-red-100',
        detail: `Revoque le ${new Date(token.revokedAt).toLocaleString()}`,
      };
    }
    if (token.usedAt) {
      return {
        label: 'used',
        tone: 'bg-blue-500/20 text-blue-100',
        detail: `Utilise le ${new Date(token.usedAt).toLocaleString()}`,
      };
    }
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      return {
        label: 'expired',
        tone: 'bg-amber-500/20 text-amber-100',
        detail: `Expire le ${new Date(token.expiresAt).toLocaleString()}`,
      };
    }
    return {
      label: 'active',
      tone: 'bg-emerald-500/20 text-emerald-100',
      detail: `Expire le ${new Date(token.expiresAt).toLocaleString()}`,
    };
  }

  const activeRegistrationTokenCount = useMemo(
    () =>
      registrationTokens.filter((token) => getRegistrationTokenState(token).label === 'active').length,
    [registrationTokens]
  );

  const onboardingTokenHint = useMemo(() => {
    if (freshRegistrationToken) {
      return 'Un token frais est pret a etre colle sur la machine.';
    }
    if (activeRegistrationTokenCount > 0) {
      return `${activeRegistrationTokenCount} token(s) encore actif(s) disponible(s).`;
    }
    if (registrationTokens.length > 0) {
      return 'Les tokens existants sont uses, expires ou revoques. Regenere-en un avant le prochain connect.';
    }
    return 'Genere un token temporaire avant le premier connect.';
  }, [activeRegistrationTokenCount, freshRegistrationToken, registrationTokens.length]);

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.id === selectedMachineId) ?? null,
    [machines, selectedMachineId]
  );
  const onboardingChecklist = useMemo(() => {
    const latestMachine = selectedMachine || machines[0] || null;
    return [
      {
        label: 'Token d’enrolement genere',
        done: Boolean(freshRegistrationToken || activeRegistrationTokenCount > 0),
        hint: onboardingTokenHint,
      },
      {
        label: 'Machine connectee',
        done: Boolean(latestMachine),
        hint: latestMachine
          ? `${latestMachine.machineName} est enregistree dans EkyBot.`
          : 'Aucune machine Companion enregistree pour le moment.',
      },
      {
        label: 'Inventory recu',
        done: Boolean(latestMachine?.runtimeState?.lastInventoryUploadedAt),
        hint: latestMachine?.runtimeState?.lastInventoryUploadedAt
          ? `Dernier inventory recu le ${new Date(
              latestMachine.runtimeState.lastInventoryUploadedAt
            ).toLocaleString()}.`
          : "Lance companion:connect puis companion:doctor pour envoyer le premier inventory.",
      },
      {
        label: 'Agents detectes',
        done: Boolean((latestMachine?.counts?.agents || 0) > 0),
        hint:
          (latestMachine?.counts?.agents || 0) > 0
            ? `${latestMachine?.counts?.agents || 0} agent(s) detecte(s) sur cette machine.`
            : "Aucun agent remonte pour l'instant.",
      },
      {
        label: 'Memoire synchronisee',
        done: Boolean(latestMachine?.runtimeState?.lastMemoryUploadedAt),
        hint: latestMachine?.runtimeState?.lastMemoryUploadedAt
          ? `Derniere synchro memoire le ${new Date(
              latestMachine.runtimeState.lastMemoryUploadedAt
            ).toLocaleString()}.`
          : 'Le runtime memoire apparaitra ici apres le premier companion:sync.',
      },
    ];
  }, [
    activeRegistrationTokenCount,
    freshRegistrationToken,
    machines,
    onboardingTokenHint,
    selectedMachine,
  ]);
  const connectSnippet = useMemo(
    () => `export EKYBOT_APP_URL="${companionAppUrl}"
export EKYBOT_COMPANION_REGISTRATION_TOKEN="${freshRegistrationToken || 'ekrt_...'}"
npm run companion:connect
npm run companion:doctor`,
    [companionAppUrl, freshRegistrationToken]
  );
  const followUpSnippet = useMemo(
    () => `npm run companion:api-check
npm run companion:memory-check
npm run companion:disconnect`,
    []
  );
  const pendingOperationTypesByOpenclawAgentId = useMemo(() => {
    return operations.reduce((acc, operation) => {
      if (operation.status !== 'pending') {
        return acc;
      }

      const openclawAgentId =
        typeof operation.payload?.openclawAgentId === 'string'
          ? operation.payload.openclawAgentId
          : null;
      if (!openclawAgentId) {
        return acc;
      }

      acc[openclawAgentId] = [...(acc[openclawAgentId] || []), operation.type];
      return acc;
    }, {} as Record<string, string[]>);
  }, [operations]);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const readErrorMessage = async (response: Response, fallback: string) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => null);
      return data?.error || fallback;
    }

    const text = await response.text().catch(() => '');
    if (/<!doctype html/i.test(text) || /<html/i.test(text)) {
      return fallback;
    }

    return text.trim() || fallback;
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }

    void loadMachines();
    void loadRegistrationTokens();
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!selectedMachineId) return;
    void loadMachineDetail(selectedMachineId);
    void loadOperations(selectedMachineId);
    void loadImportCandidates(selectedMachineId);
  }, [selectedMachineId]);

  async function loadMachines() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/companion/machines', {
        headers: await getAuthHeaders(),
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de charger les machines'));
      }
      const data = await response.json();
      setMachines(data.machines || []);
      if (!selectedMachineId && data.machines?.[0]?.id) {
        setSelectedMachineId(data.machines[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  async function loadMachineDetail(machineId: string) {
    try {
      const response = await fetch(`/api/companion/machines/${machineId}/inventory`, {
        headers: await getAuthHeaders(),
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de charger l’inventory'));
      }
      const data = await response.json();
      setMachineDetail(data.machine);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inventory');
    }
  }

  async function loadOperations(machineId: string) {
    try {
      const response = await fetch(`/api/companion/machines/${machineId}/operations`, {
        headers: await getAuthHeaders(),
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de charger les opérations'));
      }
      const data = await response.json();
      setOperations(data.operations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur opérations');
    }
  }

  async function loadImportCandidates(machineId: string) {
    try {
      const response = await fetch(`/api/companion/machines/${machineId}/import-candidates`, {
        headers: await getAuthHeaders(),
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de charger les candidats d’import'));
      }
      const data = await response.json();
      setImportCandidates(data.candidates || []);
      setProjectOptions(data.projects || []);
      setChannelOptions(data.channels || []);
      setImportMappings(
        Object.fromEntries(
          (data.candidates || []).map((candidate: ImportCandidate) => [
            candidate.id,
            {
              projectId: candidate.suggestedMapping?.projectId || '',
              channelId: candidate.suggestedMapping?.channelId || '',
              channelKey: candidate.suggestedMapping?.channelKey || '',
              createProjectName: candidate.suggestedMapping?.createProjectName || '',
              createChannelName: candidate.suggestedMapping?.createChannelName || '',
              createChannelKey: candidate.suggestedMapping?.createChannelKey || '',
            },
          ])
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur candidats import');
    }
  }

  async function loadRegistrationTokens() {
    try {
      const response = await fetch('/api/companion/registration-tokens', {
        headers: await getAuthHeaders(),
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de charger les tokens'));
      }
      const data = await response.json();
      setRegistrationTokens(data.tokens || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur tokens');
    }
  }

  async function createRegistrationToken() {
    try {
      const response = await fetch('/api/companion/registration-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders()),
        },
        credentials: 'omit',
        body: JSON.stringify({
          label: 'Inventory-only enrollment',
          expiresInMinutes: 60,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de créer le token'));
      }
      const data = await response.json();
      setFreshRegistrationToken(data.token?.plainToken || null);
      setSuccessMessage('Nouveau token d’enrolement genere. Copie-le tout de suite dans la machine a connecter.');
      await loadRegistrationTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création token');
    }
  }

  async function revokeRegistrationToken(tokenId: string) {
    setError(null);
    setSuccessMessage(null);
    setRevokingTokenIds((current) => [...current, tokenId]);

    try {
      const response = await fetch(`/api/companion/registration-tokens?id=${encodeURIComponent(tokenId)}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de revoquer le token'));
      }
      const data = await response.json();

      if (freshRegistrationToken) {
        const revokedFreshToken = registrationTokens.find((token) => token.id === tokenId);
        if (revokedFreshToken && !revokedFreshToken.usedAt) {
          setFreshRegistrationToken(null);
        }
      }
      setSuccessMessage('Token d’enrolement revoque. La machine devra utiliser un nouveau token pour se connecter.');
      await loadRegistrationTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur révocation token');
    } finally {
      setRevokingTokenIds((current) => current.filter((id) => id !== tokenId));
    }
  }

  async function queueOperation(type: string) {
    if (!selectedMachineId) return;
    try {
      const response = await fetch(`/api/companion/machines/${selectedMachineId}/operations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders()),
        },
        credentials: 'omit',
        body: JSON.stringify({
          type,
          payload: {
            requestedFrom: 'companion_debug_page',
          },
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de créer l’opération'));
      }
      const data = await response.json();
      await loadOperations(selectedMachineId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création opération');
    }
  }

  async function importAgent(candidate: ImportCandidate) {
    if (!selectedMachineId) {
      return;
    }

    const mapping = importMappings[candidate.id] || {
      projectId: '',
      channelId: '',
      channelKey: '',
      createProjectName: '',
      createChannelName: '',
      createChannelKey: '',
    };

    setError(null);
    setSuccessMessage(null);
    setImportingAgentIds((current) => [...current, candidate.id]);

    try {
      const queueResponse = await fetch(
        `/api/companion/machines/${selectedMachineId}/import-candidates`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeaders()),
          },
          credentials: 'omit',
          body: JSON.stringify({
            mappings: [
              {
                agentId: candidate.id,
                projectId: mapping.projectId || null,
                channelId: mapping.channelId || null,
                channelKey: mapping.channelKey || null,
                createProjectName: mapping.createProjectName || null,
                createChannelName: mapping.createChannelName || null,
                createChannelKey: mapping.createChannelKey || null,
              },
            ],
          }),
        }
      );
      if (!queueResponse.ok) {
        throw new Error(await readErrorMessage(queueResponse, 'Impossible de préparer l’import'));
      }
      const queueData = await queueResponse.json();

      const operationIds = (queueData.operations || []).map((operation: Operation) => operation.id);
      if (operationIds.length === 0) {
        throw new Error("Aucune opération d'import n'a été créée");
      }
      const adoptResponse = await fetch(
        `/api/companion/machines/${selectedMachineId}/adopt-imports`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeaders()),
          },
          credentials: 'omit',
          body: JSON.stringify({
            operationIds,
          }),
        }
      );
      if (!adoptResponse.ok) {
        throw new Error(await readErrorMessage(adoptResponse, 'Impossible d’importer cet agent dans EkyBot'));
      }
      const adoptData = await adoptResponse.json();

      await loadOperations(selectedMachineId);
      await loadMachineDetail(selectedMachineId);
      await loadImportCandidates(selectedMachineId);
      await loadMachines();
      setSuccessMessage(`Agent ${candidate.name} importé dans EkyBot. La machine appliquera ensuite le desired state.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur import agent');
    } finally {
      setImportingAgentIds((current) => current.filter((id) => id !== candidate.id));
    }
  }

  async function deleteExternalAgent(agentId: string, agentName: string) {
    if (!selectedMachineId) {
      return;
    }

    const confirmed = window.confirm(
      `Supprimer complètement ${agentName} ? Cette action retirera sa config Companion et son workspace local au prochain reconcile.`
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setDeletingAgentIds((current) => [...current, agentId]);

    try {
      const response = await fetch(
        `/api/companion/machines/${selectedMachineId}/agents/${agentId}`,
        {
          method: 'DELETE',
          headers: await getAuthHeaders(),
          credentials: 'omit',
        }
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Impossible de supprimer cet agent'));
      }

      await loadOperations(selectedMachineId);
      await loadMachineDetail(selectedMachineId);
      await loadImportCandidates(selectedMachineId);
      await loadMachines();
      setSuccessMessage(
        `Suppression complète de ${agentName} planifiée. Companion nettoiera la config et le workspace local au prochain reconcile.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression agent');
    } finally {
      setDeletingAgentIds((current) => current.filter((id) => id !== agentId));
    }
  }

  function updateImportMapping(
    agentId: string,
    patch: Partial<ImportMappingState>
  ) {
    setImportMappings((current) => ({
      ...current,
      [agentId]: {
        ...(current[agentId] || {
          projectId: '',
          channelId: '',
          channelKey: '',
          createProjectName: '',
          createChannelName: '',
          createChannelKey: '',
        }),
        ...patch,
      },
    }));
  }

  const importSummary = useMemo(() => {
    return importCandidates.reduce(
      (acc, candidate) => {
        acc[candidate.classification] = (acc[candidate.classification] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [importCandidates]);

  const importCandidateByOpenclawId = useMemo(
    () =>
      Object.fromEntries(
        importCandidates.map((candidate) => [candidate.openclawAgentId, candidate] as const)
      ),
    [importCandidates]
  );

  const selectedMachineAgents = machineDetail?.agents || [];
  const linkedMachineAgents = selectedMachineAgents.filter((agent) => agent.ekybotAgent);
  const externalMachineAgents = selectedMachineAgents.filter((agent) => !agent.ekybotAgent);

  return (
    <PageLayout maxWidth="7xl">
      <div className="mx-auto max-w-6xl p-6 text-white">
        <div className="mb-6">
          <h1 className="text-4xl font-bold">Companion OpenClaw</h1>
          <p className="text-white/70 mt-2">
            Connecte ta machine, importe tes agents existants et laisse EkyBot synchroniser la
            partie gérée d’OpenClaw sans toucher au reste.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/45">Etape 1</div>
              <div className="mt-2 font-semibold">Connecte la machine</div>
              <div className="mt-1 text-sm text-white/60">
                Enregistre une machine Companion pour qu’EkyBot puisse lire son inventory et suivre sa santé.
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/45">Etape 2</div>
              <div className="mt-2 font-semibold">Importe les agents utiles</div>
              <div className="mt-1 text-sm text-white/60">
                Pour chaque agent externe, choisis son projet/channel puis importe-le dans EkyBot.
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/45">Etape 3</div>
              <div className="mt-2 font-semibold">Surveille la synchro</div>
              <div className="mt-1 text-sm text-white/60">
                Vérifie quels agents sont liés, synchronisés localement, ou nécessitent encore une action.
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-100">
            {successMessage}
          </div>
        )}

        {!isSignedIn ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            Connecte-toi pour voir les machines Companion.
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            Chargement des machines...
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4">
                  <div className="text-sm uppercase tracking-[0.2em] text-white/50">Étape 1</div>
                  <h2 className="mt-1 text-2xl font-semibold">Connecter une machine</h2>
                  <div className="mt-2 text-sm text-white/60">
                    Enregistre une machine OpenClaw dans EkyBot puis surveille son état général.
                  </div>
                  {selectedMachine?.runtimeState?.lastMemoryUploadedAt && (
                    <div className="mt-3 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-3 text-sm text-blue-100">
                      Derniere synchro memoire :{' '}
                      {new Date(selectedMachine.runtimeState.lastMemoryUploadedAt).toLocaleString()}
                      {selectedMachine.runtimeState.lastMemorySyncSummary && (
                        <span className="ml-2 text-blue-100/80">
                          ({selectedMachine.runtimeState.lastMemorySyncSummary.syncedAgents} agent(s),{' '}
                          {selectedMachine.runtimeState.lastMemorySyncSummary.syncedFiles} fichier(s))
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {machines.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-white/60">
                      Aucune machine enregistrée.
                    </div>
                  )}
                  {machines.map((machine) => (
                    <button
                      key={machine.id}
                      type="button"
                      onClick={() => setSelectedMachineId(machine.id)}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        selectedMachineId === machine.id
                          ? 'border-blue-400/60 bg-blue-500/15'
                          : 'border-white/10 bg-black/20 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">{machine.machineName}</div>
                          <div className="mt-1 text-sm text-white/60">
                            {machine.platform} · {machine.configMode}
                          </div>
                        </div>
                        <div className="text-xs uppercase text-white/60">{machine.status}</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full bg-black/30 px-2 py-1 text-white/55">
                          {machine.counts.agents} agents détectés
                        </span>
                        <span className="rounded-full bg-black/30 px-2 py-1 text-white/55">
                          Pending {machine.pendingOperationCount}
                        </span>
                        {machine.runtimeState?.lastMemoryUploadedAt && (
                          <span className="rounded-full bg-blue-500/20 px-2 py-1 text-blue-100">
                            Memoire sync {new Date(machine.runtimeState.lastMemoryUploadedAt).toLocaleTimeString()}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-1 ${
                            machine.runtimeState?.driftDetected
                              ? 'bg-amber-500/20 text-amber-200'
                              : 'bg-emerald-500/20 text-emerald-200'
                          }`}
                        >
                          {machine.runtimeState?.driftDetected ? 'Drift detected' : 'In sync'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm uppercase tracking-[0.2em] text-white/50">
                      Enrollment
                    </div>
                    <h2 className="mt-1 text-2xl font-semibold">Token d’enrôlement</h2>
                    <div className="mt-2 max-w-2xl text-sm text-white/60">
                      Génére un token temporaire pour enregistrer une nouvelle machine Companion
                      sans exposer ta session utilisateur.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void createRegistrationToken()}
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-sm hover:bg-emerald-400"
                  >
                    Generate token
                  </button>
                </div>

                {freshRegistrationToken && (
                  <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4">
                    <div className="text-sm text-emerald-200">
                      Token affiché une seule fois, à utiliser dans le companion :
                    </div>
                    <div className="mt-2 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-sm text-emerald-100">
                      {freshRegistrationToken}
                    </div>
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-4 grid gap-2">
                    {onboardingChecklist.map((step) => (
                      <div
                        key={step.label}
                        className="flex items-start gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-3"
                      >
                        <div
                          className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                            step.done ? 'bg-emerald-400' : 'bg-amber-300'
                          }`}
                        />
                        <div>
                          <div className="text-sm font-medium text-white">{step.label}</div>
                          <div className="mt-1 text-xs text-white/50">{step.hint}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-sm font-medium text-white">Flow recommandé</div>
                  <div className="mt-2 text-sm text-white/60">
                    1. Génère un token ici. 2. Sur la machine OpenClaw, exporte-le puis lance une seule
                    commande. 3. Vérifie la santé avec le doctor.
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 px-3 py-3 text-xs text-emerald-100">
{connectSnippet}
                  </pre>
                  <div className="mt-3 text-xs text-white/45">
                    La commande <code>companion:connect</code> enregistre la machine puis envoie le premier
                    heartbeat, l’inventory et le runtime mémoire. <code>companion:doctor</code> vérifie ensuite
                    l’état local et l’accès API.
                  </div>
                  {registrationTokens.length > 0 &&
                    activeRegistrationTokenCount === 0 &&
                    !freshRegistrationToken && (
                      <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
                        Aucun token actif disponible pour le prochain connect. Regénère un token avant de
                        relancer <code className="mx-1">companion:connect</code> ou{' '}
                        <code>companion:register</code>.
                      </div>
                    )}
                  <div className="mt-4 text-sm font-medium text-white">Commandes utiles ensuite</div>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 px-3 py-3 text-xs text-blue-100">
{followUpSnippet}
                  </pre>
                  <div className="mt-3 text-xs text-white/45">
                    <code>companion:api-check</code> confirme l’auth, <code>companion:memory-check</code>
                    liste le payload mémoire local, et <code>companion:disconnect</code> nettoie la
                    configuration locale si besoin.
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {registrationTokens.length ? (
                    registrationTokens.map((token) => (
                      <div key={token.id} className="rounded-xl bg-black/20 p-4">
                        {(() => {
                          const state = getRegistrationTokenState(token);
                          const canRevoke = !token.revokedAt && !token.usedAt;
                          const isRevoking = revokingTokenIds.includes(token.id);
                          return (
                            <>
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{token.label}</div>
                          <div className={`rounded-full px-2 py-1 text-xs uppercase ${state.tone}`}>
                            {state.label}
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-white/45">
                          Cree le {new Date(token.createdAt).toLocaleString()}
                        </div>
                        <div className="mt-1 text-xs text-white/55">{state.detail}</div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="text-[11px] text-white/40">
                            Utilise un token actif unique par machine pour eviter les 401 silencieux au moment du register.
                          </div>
                          {canRevoke && (
                            <button
                              type="button"
                              onClick={() => void revokeRegistrationToken(token.id)}
                              disabled={isRevoking}
                              className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isRevoking ? 'Revocation...' : 'Revoquer'}
                            </button>
                          )}
                        </div>
                            </>
                          );
                        })()}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl bg-black/20 p-4 text-white/60">
                      Aucun token généré pour le moment.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm uppercase tracking-[0.2em] text-white/50">Étape 2</div>
                  <h2 className="mt-1 text-2xl font-semibold">Importer les agents existants</h2>
                  <div className="mt-2 max-w-3xl text-sm text-white/60">
                    Une seule liste pour voir les agents détectés dans OpenClaw, vérifier s’ils sont
                    déjà liés à EkyBot et importer un agent externe directement dans EkyBot.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                  <span className="rounded-full bg-black/20 px-3 py-1">managed {importSummary.managed || 0}</span>
                  <span className="rounded-full bg-black/20 px-3 py-1">external {importSummary.external || 0}</span>
                  <span className="rounded-full bg-black/20 px-3 py-1">adoptable {importSummary.adoptable || 0}</span>
                  <span className="rounded-full bg-black/20 px-3 py-1">conflicted {importSummary.conflicted || 0}</span>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4 text-sm text-white/65">
                Chaque agent externe peut maintenant etre importé individuellement.
                EkyBot prépare et adopte l’agent automatiquement en arrière-plan, puis Companion l’appliquera localement au prochain reconcile.
              </div>

              <div className="mt-5 space-y-6">
                {linkedMachineAgents.length > 0 && (
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">Déjà gérés par EkyBot</h3>
                        <div className="text-sm text-white/55">
                          Ces agents sont déjà adoptés. Modifie-les ensuite depuis la page Agents.
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200">
                        {linkedMachineAgents.length} lié{linkedMachineAgents.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-4">
                      {linkedMachineAgents.map((agent) => {
                        const syncState = deriveAgentSyncStateFromInventory({
                          agent,
                          pendingOperationTypes:
                            pendingOperationTypesByOpenclawAgentId[agent.openclawAgentId] || [],
                        });

                        return (
                          <CompanionAgentSummary
                            key={agent.id}
                            title={agent.name}
                            model={agent.model}
                            workspacePath={agent.workspacePath}
                            openclawAgentId={agent.openclawAgentId}
                            syncState={syncState}
                            extraBadges={[
                              { label: 'Linked to EkyBot', tone: 'emerald' },
                              ...(agent.project
                                ? [{ label: `Project: ${agent.project.name}`, tone: 'blue' as const }]
                                : []),
                              ...(agent.channel
                                ? [{ label: `Channel: ${agent.channel.name}`, tone: 'blue' as const }]
                                : []),
                            ]}
                          >
                            <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/65">
                              <div>EkyBot agent: {agent.ekybotAgent?.name}</div>
                              <div className="mt-1">
                                Desired model: {agent.ekybotAgent?.model}
                              </div>
                              <div className="mt-1">OpenClaw model: {agent.model || 'unknown'}</div>
                              <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                                Cet agent est déjà relié. Tu n’as plus besoin de l’importer ici.
                              </div>
                            </div>
                          </CompanionAgentSummary>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">À importer depuis OpenClaw</h3>
                      <div className="text-sm text-white/55">
                        Ces agents existent sur la machine mais ne sont pas encore gérés par EkyBot.
                      </div>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/65">
                      {externalMachineAgents.length} externe{externalMachineAgents.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {externalMachineAgents.length ? (
                    <div className="space-y-4">
                      {externalMachineAgents.map((agent) => {
                    const candidate = importCandidateByOpenclawId[agent.openclawAgentId];
                    const canImport = candidate?.recommendedAction === 'queue_import';
                    const mapping = candidate
                      ? importMappings[candidate.id] || {
                          projectId: '',
                          channelId: '',
                          channelKey: '',
                          createProjectName: '',
                          createChannelName: '',
                          createChannelKey: '',
                        }
                      : null;
                    const filteredChannels = channelOptions.filter(
                      (channel) =>
                        !mapping?.projectId || !channel.projectId || channel.projectId === mapping.projectId
                    );
                    const syncState = deriveAgentSyncStateFromInventory({
                      agent,
                      pendingOperationTypes:
                        pendingOperationTypesByOpenclawAgentId[agent.openclawAgentId] || [],
                    });

                        return (
                          <CompanionAgentSummary
                            key={agent.id}
                            title={agent.name}
                            model={agent.model}
                            workspacePath={agent.workspacePath}
                            openclawAgentId={agent.openclawAgentId}
                            syncState={syncState}
                            extraBadges={[
                              { label: 'Not linked', tone: 'slate' },
                              ...(agent.project
                                ? [{ label: `Project: ${agent.project.name}`, tone: 'blue' as const }]
                                : []),
                              ...(agent.channel
                                ? [{ label: `Channel: ${agent.channel.name}`, tone: 'blue' as const }]
                                : []),
                            ]}
                          >
                            {candidate ? (
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                            {candidate.warnings.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-2">
                                {candidate.warnings.map((warning) => (
                                  <span
                                    key={warning}
                                    className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
                                  >
                                    {warning}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="mb-3 text-xs text-white/60">
                              {canImport
                                ? 'Choisis le projet et le channel EkyBot, puis importe directement cet agent.'
                                : "Cet agent ne peut pas être importé dans son état actuel."}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="block">
                                <div className="mb-1 text-xs uppercase text-white/40">Projet cible</div>
                                <select
                                  value={mapping?.projectId || ''}
                                  disabled={!canImport}
                                  onChange={(event) =>
                                    updateImportMapping(candidate.id, {
                                      projectId: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                                >
                                  <option value="">Aucun projet existant</option>
                                  {projectOptions.map((project) => (
                                    <option key={project.id} value={project.id}>
                                      {project.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="block">
                                <div className="mb-1 text-xs uppercase text-white/40">
                                  Nouveau projet si besoin
                                </div>
                                <input
                                  value={mapping?.createProjectName || ''}
                                  disabled={!canImport}
                                  onChange={(event) =>
                                    updateImportMapping(candidate.id, {
                                      createProjectName: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                                  placeholder="Nom du projet à créer"
                                />
                              </label>

                              <label className="block">
                                <div className="mb-1 text-xs uppercase text-white/40">Channel existant</div>
                                <select
                                  value={mapping?.channelId || ''}
                                  disabled={!canImport}
                                  onChange={(event) =>
                                    updateImportMapping(candidate.id, {
                                      channelId: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                                >
                                  <option value="">Aucun channel existant</option>
                                  {filteredChannels.map((channel) => (
                                    <option key={channel.id} value={channel.id}>
                                      #{channel.key} · {channel.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="block">
                                <div className="mb-1 text-xs uppercase text-white/40">
                                  Nouveau channel
                                </div>
                                <input
                                  value={mapping?.createChannelName || ''}
                                  disabled={!canImport}
                                  onChange={(event) =>
                                    updateImportMapping(candidate.id, {
                                      createChannelName: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                                  placeholder="Nom du channel à créer"
                                />
                              </label>

                              <label className="block md:col-span-2">
                                <div className="mb-1 text-xs uppercase text-white/40">
                                  Clé channel cible
                                </div>
                                <input
                                  value={mapping?.channelKey || ''}
                                  disabled={!canImport}
                                  onChange={(event) =>
                                    updateImportMapping(candidate.id, {
                                      channelKey: event.target.value,
                                      createChannelKey: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                                  placeholder="channel-key"
                                />
                              </label>
                            </div>

                            <div className="mt-4 flex items-center justify-between gap-3">
                              <div className="text-xs text-white/45">
                                L’import liera l’agent à EkyBot puis préparera sa gestion locale via Companion.
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void deleteExternalAgent(agent.id, agent.name)}
                                  disabled={deletingAgentIds.includes(agent.id)}
                                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/40"
                                >
                                  {deletingAgentIds.includes(agent.id)
                                    ? 'Suppression...'
                                    : 'Supprimer complètement'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void importAgent(candidate)}
                                  disabled={!canImport || importingAgentIds.includes(candidate.id)}
                                  className="rounded-lg bg-emerald-500 px-3 py-2 text-sm text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                                >
                                  {importingAgentIds.includes(candidate.id)
                                    ? 'Import en cours...'
                                    : 'Importer dans EkyBot'}
                                </button>
                              </div>
                            </div>
                          </div>
                            ) : null}
                          </CompanionAgentSummary>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-black/20 p-4 text-white/60">
                      Aucun agent externe restant à importer sur cette machine.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-3">
                <div className="text-sm uppercase tracking-[0.2em] text-white/50">Étape 3</div>
                <h2 className="mt-1 text-2xl font-semibold">
                  {selectedMachine?.machineName || 'Voir l’état de synchro'}
                </h2>
                <div className="mt-2 max-w-3xl text-sm text-white/60">
                  Vérifie la santé de la machine et l’état global de synchronisation. Les détails
                  techniques restent dans le panneau avancé ci-dessous.
                </div>
              </div>

              {selectedMachine && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl bg-black/20 p-4">
                    <div className="text-xs uppercase text-white/40">Machine</div>
                    <div className="mt-2 text-sm text-white/80">{selectedMachine.machineName}</div>
                  </div>
                  <div className="rounded-xl bg-black/20 p-4">
                    <div className="text-xs uppercase text-white/40">Companion</div>
                    <div className="mt-2 text-sm text-white/80">
                      {selectedMachine.companionVersion || 'n/a'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-black/20 p-4">
                    <div className="text-xs uppercase text-white/40">OpenClaw</div>
                    <div className="mt-2 text-sm text-white/80">
                      {selectedMachine.openclawVersion || 'n/a'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-black/20 p-4">
                    <div className="text-xs uppercase text-white/40">Dernière synchro inventory</div>
                    <div className="mt-2 text-sm text-white/80">
                      {selectedMachine.runtimeState?.lastInventoryUploadedAt
                        ? new Date(selectedMachine.runtimeState.lastInventoryUploadedAt).toLocaleString()
                        : 'never'}
                    </div>
                  </div>
                </div>
              )}

              {selectedMachineId && (
                <details className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4">
                  <summary className="cursor-pointer list-none text-sm font-medium text-white">
                    Advanced machine details and operations
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => queueOperation('scan_inventory')}
                        className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                      >
                        Queue Scan
                      </button>
                      <button
                        type="button"
                        onClick={() => queueOperation('bootstrap_include')}
                        className="rounded-lg bg-blue-500 px-3 py-2 text-sm hover:bg-blue-400"
                      >
                        Queue Bootstrap Include
                      </button>
                    </div>

                    {selectedMachine && (
                      <div className="rounded-xl bg-black/20 p-4 text-sm text-white/70">
                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            Last desired sync:{' '}
                            {selectedMachine.runtimeState?.lastDesiredSyncAt
                              ? new Date(selectedMachine.runtimeState.lastDesiredSyncAt).toLocaleString()
                              : 'never'}
                          </div>
                          <div>
                            Last reconcile:{' '}
                            {selectedMachine.runtimeState?.lastReconciledAt
                              ? new Date(selectedMachine.runtimeState.lastReconciledAt).toLocaleString()
                              : 'never'}
                          </div>
                          <div>
                            Last apply:{' '}
                            {selectedMachine.runtimeState?.lastApplyCompletedAt
                              ? new Date(selectedMachine.runtimeState.lastApplyCompletedAt).toLocaleString()
                              : 'never'}
                          </div>
                          <div>
                            Desired version:{' '}
                            {selectedMachine.runtimeState?.lastAppliedDesiredConfigVersion ?? 'n/a'}
                          </div>
                          <div>
                            Managed fragment:{' '}
                            {selectedMachine.runtimeState?.lastAppliedManagedFragmentPath || 'n/a'}
                          </div>
                          <div>Drift reason: {selectedMachine.runtimeState?.driftReason || 'none'}</div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {operations.length ? (
                        operations.map((operation) => (
                          <div key={operation.id} className="rounded-xl bg-black/20 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium">{operation.type}</div>
                              <div className="text-xs uppercase text-white/50">{operation.status}</div>
                            </div>
                            <div className="mt-2 text-xs text-white/40">
                              {new Date(operation.requestedAt).toLocaleString()}
                            </div>
                            {operation.error && (
                              <div className="mt-2 text-sm text-red-300">{operation.error}</div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl bg-black/20 p-4 text-white/60">
                          Aucune opération pour le moment.
                        </div>
                      )}
                    </div>
                  </div>
                </details>
              )}
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
