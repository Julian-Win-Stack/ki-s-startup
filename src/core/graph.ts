export type GraphRefKind =
  | "state"
  | "artifact"
  | "file"
  | "workspace"
  | "commit"
  | "job"
  | "prompt";

export type GraphRef = {
  readonly kind: GraphRefKind;
  readonly ref: string;
  readonly label?: string;
};

export type GraphRunStatus =
  | "active"
  | "awaiting_confirmation"
  | "completed"
  | "blocked"
  | "failed"
  | "canceled";

export type GraphNodeStatus =
  | "planned"
  | "ready"
  | "dispatched"
  | "completed"
  | "blocked"
  | "failed"
  | "canceled";

export type GraphNodeBase = {
  readonly nodeId: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly status: GraphNodeStatus;
};

export type GraphState<TNode extends GraphNodeBase> = {
  readonly graphId: string;
  readonly status: GraphRunStatus;
  readonly currentNodeId?: string;
  readonly order: ReadonlyArray<string>;
  readonly nodes: Readonly<Record<string, TNode>>;
  readonly updatedAt: number;
};

export type GraphProjection<TNode extends GraphNodeBase> = {
  readonly currentNode?: TNode;
  readonly planned: ReadonlyArray<TNode>;
  readonly ready: ReadonlyArray<TNode>;
  readonly completed: ReadonlyArray<TNode>;
  readonly blocked: ReadonlyArray<TNode>;
  readonly terminal: ReadonlyArray<TNode>;
};

const nodeList = <TNode extends GraphNodeBase>(state: GraphState<TNode>): TNode[] =>
  state.order
    .map((nodeId) => state.nodes[nodeId])
    .filter((node): node is TNode => Boolean(node));

const depsSatisfied = <TNode extends GraphNodeBase>(state: GraphState<TNode>, node: TNode): boolean =>
  node.dependsOn.every((depId) => state.nodes[depId]?.status === "completed");

export const createGraphState = <TNode extends GraphNodeBase>(
  graphId: string,
  updatedAt: number,
  status: GraphRunStatus = "active",
): GraphState<TNode> => ({
  graphId,
  status,
  order: [],
  nodes: {},
  updatedAt,
});

export const graphNodeList = nodeList;

export const graphProjection = <TNode extends GraphNodeBase>(state: GraphState<TNode>): GraphProjection<TNode> => {
  const nodes = nodeList(state);
  return {
    currentNode: state.currentNodeId ? state.nodes[state.currentNodeId] : undefined,
    planned: nodes.filter((node) => node.status === "planned"),
    ready: nodes.filter((node) => node.status === "ready"),
    completed: nodes.filter((node) => node.status === "completed"),
    blocked: nodes.filter((node) => node.status === "blocked" || node.status === "failed"),
    terminal: nodes.filter((node) => (
      node.status === "completed"
      || node.status === "blocked"
      || node.status === "failed"
      || node.status === "canceled"
    )),
  };
};

export const runnableNodes = <TNode extends GraphNodeBase>(state: GraphState<TNode>): ReadonlyArray<TNode> => {
  if (state.currentNodeId) return [];
  return nodeList(state).filter((node) =>
    node.status === "ready"
    && depsSatisfied(state, node)
  );
};

export const activatableNodes = <TNode extends GraphNodeBase>(state: GraphState<TNode>): ReadonlyArray<TNode> => {
  if (state.currentNodeId) return [];
  return nodeList(state).filter((node) =>
    node.status === "planned"
    && depsSatisfied(state, node)
  );
};
