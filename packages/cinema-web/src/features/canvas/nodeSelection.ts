type MultiSelectModifier = {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

export function preserveNodeSelection<T extends { id: string; selected?: boolean }>(
  current: readonly T[],
  next: readonly T[],
  preferredNodeID?: string | null,
): T[] {
  if (preferredNodeID && next.some((node) => node.id === preferredNodeID)) {
    return next.map((node) => {
      const selected = node.id === preferredNodeID
      return node.selected === selected ? node : { ...node, selected }
    })
  }

  const currentByID = new Map(current.map((node) => [node.id, node]))

  return next.map((node) => {
    const currentNode = currentByID.get(node.id)
    const selected = currentNode?.selected ?? node.selected

    return selected === node.selected
      ? node
      : { ...node, selected }
  })
}

export function hasMultiSelectModifier(modifier: MultiSelectModifier): boolean {
  return modifier.ctrlKey || modifier.metaKey
}

export function toggleNodeSelection(
  selectedNodeIDs: Iterable<string>,
  nodeID: string,
): Set<string> {
  const nextSelectedNodeIDs = new Set(selectedNodeIDs)

  if (nextSelectedNodeIDs.has(nodeID)) {
    nextSelectedNodeIDs.delete(nodeID)
  } else {
    nextSelectedNodeIDs.add(nodeID)
  }

  return nextSelectedNodeIDs
}

export function shouldDeferSingleSelection(
  selectedNodeIDs: Iterable<string>,
  nodeID: string,
): boolean {
  let selectedCount = 0
  let includesNode = false

  for (const selectedNodeID of selectedNodeIDs) {
    selectedCount += 1
    if (selectedNodeID === nodeID) includesNode = true
  }

  return includesNode && selectedCount > 1
}
