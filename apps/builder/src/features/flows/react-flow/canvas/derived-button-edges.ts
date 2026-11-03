import {
  type ButtonStepProps,
  buttonTypes,
  type FlowNode,
} from "@chatbotx.io/flow-config"
import { type Edge, MarkerType } from "@xyflow/react"

/**
 * Read-only arrows for every button whose action is Start Another Node but
 * that has no saved edge: ManyChat draws the route a button takes, ChatbotX
 * only draws edges the user dragged. These are computed from node data on
 * every render and never written back, so the saved flow is untouched; the
 * edge's `data.derived` keeps the delete toolbar off it.
 */

export const DERIVED_EDGE_PREFIX = "derived:"

const routedButtonTypes = new Set<string>([
  buttonTypes.enum.startAnotherNode,
  buttonTypes.enum.sendMessage,
  buttonTypes.enum.performAction,
])

type RoutedButton = Pick<ButtonStepProps, "id" | "buttonType" | "beforeStep">

const targetOf = (button: RoutedButton): string | null => {
  if (!(button.buttonType && routedButtonTypes.has(button.buttonType))) {
    return null
  }
  const beforeStep = button.beforeStep as { nodeId?: string } | null
  return beforeStep?.nodeId || null
}

/** Every button that can carry a route, wherever the node keeps it. */
function* routedButtons(node: FlowNode): Generator<RoutedButton> {
  const details = node.data.details as {
    steps?: unknown[]
    quickReplies?: RoutedButton[]
  }
  for (const step of details.steps ?? []) {
    const s = step as {
      buttons?: RoutedButton[]
      cards?: { buttons?: RoutedButton[] }[]
    }
    for (const button of s.buttons ?? []) {
      yield button
    }
    for (const card of s.cards ?? []) {
      for (const button of card.buttons ?? []) {
        yield button
      }
    }
  }
  for (const button of details.quickReplies ?? []) {
    yield button
  }
}

export function deriveButtonEdges(
  nodes: readonly FlowNode[],
  savedEdges: readonly Edge[],
): Edge[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const routedHandles = new Set(
    savedEdges.map((edge) => edge.sourceHandle).filter(Boolean),
  )
  const derived: Edge[] = []

  for (const node of nodes) {
    if (!node.data?.details) {
      continue
    }
    for (const button of routedButtons(node)) {
      const target = targetOf(button)
      if (
        !target ||
        target === node.id ||
        !nodeIds.has(target) ||
        routedHandles.has(button.id)
      ) {
        continue
      }
      routedHandles.add(button.id)
      derived.push({
        id: `${DERIVED_EDGE_PREFIX}${button.id}`,
        source: node.id,
        sourceHandle: button.id,
        target,
        targetHandle: target,
        type: "buttonedge",
        deletable: false,
        selectable: false,
        data: { derived: true },
        markerEnd: { type: MarkerType.ArrowClosed },
      })
    }
  }

  return derived
}

export const isDerivedEdge = (edge: Pick<Edge, "id">) =>
  edge.id.startsWith(DERIVED_EDGE_PREFIX)

/**
 * The saved edges only. Every read of React Flow's store that goes on to
 * persist, publish, validate or snapshot edges must pass through here, or a
 * derived arrow would be written into the flow.
 */
export const withoutDerivedEdges = <E extends Pick<Edge, "id">>(
  edges: readonly E[],
): E[] => edges.filter((edge) => !isDerivedEdge(edge))
