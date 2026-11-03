import {
  type ButtonStepProps,
  buttonTypes,
  type FlowNode,
  sendMessageNodeDefaultFn,
  sendTextStepDefaultFn,
  startAnotherNodeStepDefaultFn,
  startExternalFlowStepDefaultFn,
} from "@chatbotx.io/flow-config"
import type { Edge } from "@xyflow/react"
import { describe, expect, test } from "vitest"
import { deriveButtonEdges, isDerivedEdge } from "../derived-button-edges"

/**
 * The live two-step flow: node 1 opener with "Yes, send it over!" → Start
 * Another Node → node 2 recipe with "Berberine Gummies" → Start External
 * Flow. Only the first button routes inside this flow.
 */
function twoStepFlow(): {
  opener: FlowNode
  recipe: FlowNode
  openerButton: ButtonStepProps
} {
  const recipe = sendMessageNodeDefaultFn({
    nodeProps: { id: "node-2", position: { x: 500, y: 0 } },
    dataProps: { name: "Recipe" },
  })
  const openerButton: ButtonStepProps = {
    id: "btn-yes",
    label: "Yes, send it over!",
    buttonType: buttonTypes.enum.startAnotherNode,
    beforeStep: startAnotherNodeStepDefaultFn({
      nodeId: recipe.id,
      viewOnly: true,
    }),
    steps: [],
  }
  const gummiesButton: ButtonStepProps = {
    id: "btn-gummies",
    label: "Berberine Gummies",
    buttonType: buttonTypes.enum.startExternalFlow,
    beforeStep: startExternalFlowStepDefaultFn(),
    steps: [],
  }
  const withButton = (
    node: ReturnType<typeof sendMessageNodeDefaultFn>,
    button: ButtonStepProps,
  ): FlowNode => ({
    ...node,
    data: {
      ...node.data,
      details: {
        ...node.data.details,
        steps: [sendTextStepDefaultFn({ buttons: [button] })],
      },
    },
  })
  const opener = withButton(
    sendMessageNodeDefaultFn({
      nodeProps: { id: "node-1", position: { x: 0, y: 0 } },
      dataProps: { name: "Opener", isStartNode: true },
    }),
    openerButton,
  )
  return { opener, recipe: withButton(recipe, gummiesButton), openerButton }
}

describe("deriveButtonEdges", () => {
  test("draws the Start Another Node route of a button that has no saved edge", () => {
    const { opener, recipe, openerButton } = twoStepFlow()

    const edges = deriveButtonEdges([opener, recipe], [])

    expect(edges).toHaveLength(1)
    const [edge] = edges
    expect(edge).toMatchObject({
      source: opener.id,
      sourceHandle: openerButton.id,
      target: recipe.id,
      targetHandle: recipe.id,
      type: "buttonedge",
      deletable: false,
      selectable: false,
      data: { derived: true },
    })
    expect(isDerivedEdge(edge)).toBe(true)
  })

  test("leaves a button alone once the user drew its edge", () => {
    const { opener, recipe, openerButton } = twoStepFlow()
    const saved: Edge = {
      id: "saved",
      source: opener.id,
      sourceHandle: openerButton.id,
      target: recipe.id,
      targetHandle: recipe.id,
    }

    expect(deriveButtonEdges([opener, recipe], [saved])).toEqual([])
  })

  test("ignores external-flow buttons and routes to nodes outside the flow", () => {
    const { opener, recipe } = twoStepFlow()

    // The recipe node's only button starts another flow: nothing to draw.
    expect(deriveButtonEdges([recipe], [])).toEqual([])
    // The opener's target is not on the canvas: nothing to draw.
    expect(deriveButtonEdges([opener], [])).toEqual([])
  })

  test("quick replies and card buttons route too", () => {
    const { opener, recipe } = twoStepFlow()
    const quickReply: ButtonStepProps = {
      id: "qr-1",
      label: "Quick",
      buttonType: buttonTypes.enum.sendMessage,
      beforeStep: startAnotherNodeStepDefaultFn({ nodeId: opener.id }),
      steps: [],
    }
    const withQuickReply = {
      ...recipe,
      data: {
        ...recipe.data,
        details: { ...recipe.data.details, quickReplies: [quickReply] },
      },
    } as FlowNode

    const edges = deriveButtonEdges([opener, withQuickReply], [])

    expect(edges.map((edge) => edge.sourceHandle).sort()).toEqual([
      "btn-yes",
      "qr-1",
    ])
  })
})
