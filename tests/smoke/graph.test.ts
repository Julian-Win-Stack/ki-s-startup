import assert from "node:assert/strict";
import test from "node:test";

import {
  activatableNodes,
  createGraphState,
  graphProjection,
  runnableNodes,
  type GraphNodeBase,
  type GraphState,
} from "../../src/core/graph.ts";

type TestNode = GraphNodeBase & {
  readonly title: string;
};

const withNodes = (
  state: GraphState<TestNode>,
  nodes: ReadonlyArray<TestNode>,
): GraphState<TestNode> => ({
  ...state,
  order: nodes.map((node) => node.nodeId),
  nodes: Object.fromEntries(nodes.map((node) => [node.nodeId, node])),
});

test("graph: dependency activation and replay projection stay deterministic", () => {
  const initial = withNodes(createGraphState<TestNode>("graph_demo", 1), [
    {
      nodeId: "planner",
      title: "Planner",
      dependsOn: [],
      status: "planned",
    },
    {
      nodeId: "builder",
      title: "Builder",
      dependsOn: ["planner"],
      status: "planned",
    },
    {
      nodeId: "reviewer",
      title: "Reviewer",
      dependsOn: ["builder"],
      status: "planned",
    },
  ]);

  assert.deepEqual(activatableNodes(initial).map((node) => node.nodeId), ["planner"]);
  assert.deepEqual(runnableNodes(initial).map((node) => node.nodeId), []);

  const plannerReady = withNodes(createGraphState<TestNode>("graph_demo", 2), [
    {
      nodeId: "planner",
      title: "Planner",
      dependsOn: [],
      status: "ready",
    },
    {
      nodeId: "builder",
      title: "Builder",
      dependsOn: ["planner"],
      status: "planned",
    },
    {
      nodeId: "reviewer",
      title: "Reviewer",
      dependsOn: ["builder"],
      status: "planned",
    },
  ]);

  assert.deepEqual(runnableNodes(plannerReady).map((node) => node.nodeId), ["planner"]);

  const plannerCompleted = withNodes(createGraphState<TestNode>("graph_demo", 3), [
    {
      nodeId: "planner",
      title: "Planner",
      dependsOn: [],
      status: "completed",
    },
    {
      nodeId: "builder",
      title: "Builder",
      dependsOn: ["planner"],
      status: "planned",
    },
    {
      nodeId: "reviewer",
      title: "Reviewer",
      dependsOn: ["builder"],
      status: "planned",
    },
  ]);

  assert.deepEqual(activatableNodes(plannerCompleted).map((node) => node.nodeId), ["builder"]);

  const replayA = graphProjection(plannerCompleted);
  const replayB = graphProjection(withNodes(createGraphState<TestNode>("graph_demo", 3), [
    {
      nodeId: "planner",
      title: "Planner",
      dependsOn: [],
      status: "completed",
    },
    {
      nodeId: "builder",
      title: "Builder",
      dependsOn: ["planner"],
      status: "planned",
    },
    {
      nodeId: "reviewer",
      title: "Reviewer",
      dependsOn: ["builder"],
      status: "planned",
    },
  ]));

  assert.deepEqual(replayA, replayB);
  assert.deepEqual(replayA.completed.map((node) => node.nodeId), ["planner"]);
  assert.deepEqual(replayA.planned.map((node) => node.nodeId), ["builder", "reviewer"]);
});
