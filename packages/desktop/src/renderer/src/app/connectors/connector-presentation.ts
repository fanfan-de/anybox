import type {
  ConnectorDefinition,
  ConnectorMcpBinding,
  ConnectorMcpRuntime,
  ConnectorStatus,
} from "../types"

export function isAccountConnectorDefinition(definition: ConnectorDefinition) {
  return definition.category === "account_connector"
}

export function normalizeConnectorDefinition(
  definition: ConnectorDefinition,
): ConnectorDefinition {
  const legacyRuntime: ConnectorMcpRuntime[] = definition.runtime
    ? [{
        ...definition.runtime,
        id: "default",
        name: definition.name,
        available: definition.available,
      }]
    : []

  return {
    ...definition,
    category: definition.category ?? "account_connector",
    configFields: definition.configFields ?? [],
    mcpRuntimes: definition.mcpRuntimes ?? legacyRuntime,
  }
}

export function normalizeConnectorStatus(status: ConnectorStatus): ConnectorStatus {
  const legacyBindings: ConnectorMcpBinding[] = status.generatedMcpServerID
    ? [{
        runtimeID: "default",
        serverID: status.generatedMcpServerID,
        name: status.name,
      }]
    : []

  return {
    ...status,
    mcpBindings: status.mcpBindings ?? legacyBindings,
  }
}

export function fallbackConnectorID(definitionID: string) {
  return `connector:${definitionID}:default`
}

export function connectorIDForDefinition(
  definition: ConnectorDefinition,
  statuses: ConnectorStatus[],
) {
  return statuses.find((status) => status.definitionID === definition.id)?.connectorID
    ?? fallbackConnectorID(definition.id)
}
