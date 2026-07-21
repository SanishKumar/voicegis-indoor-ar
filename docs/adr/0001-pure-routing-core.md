# ADR 0001: Keep routing deterministic and independent of worker transport

- Status: Accepted
- Date: 2026-07-22

## Context

The prototype created a new Web Worker and copied the complete graph for every route request. Its main-thread module described A*, while the executed worker used Dijkstra and a separate, less capable instruction generator. That made the tested code different from the runtime code.

## Decision

Routing now has three layers:

1. `routingCore.ts` contains pure A*, graph indexing, and turn generation.
2. `routing.worker.ts` is only the message-transport boundary.
3. `routingEngine.ts` owns a persistent worker and request correlation.

The A* heuristic derives a conservative coordinate-to-cost scale from the graph, keeping it admissible for the current edge weights. Accessibility filtering is applied while expanding edges. Tests call the same pure function used by the worker.

## Consequences

Benefits:

- Runtime behavior can be verified without a browser.
- Algorithm claims match the executed implementation.
- Worker startup and graph serialization no longer occur per route.
- Replay tooling can call the routing core directly.

Costs and limitations:

- The current worker still bundles one hardcoded graph.
- Dynamic building packages will require a versioned worker initialization message.
- The binary heap and graph index are intentionally simple; hierarchical routing is deferred until multi-floor packages provide realistic scale.
