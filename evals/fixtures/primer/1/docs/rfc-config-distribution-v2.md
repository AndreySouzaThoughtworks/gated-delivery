# RFC: Config distribution v2

Status: Proposed
Author: platform-config
Last updated: 2026-09-30

## Problem

Push delivery from config-sync to every runtime pod fails partially when pods restart mid-push. Those tenants are marked stale and need a manual recompile.

## Proposal

Runtime pods pull instead: each pod polls the bundle store every 30 seconds for its tenant's latest hash and loads a new bundle when the hash changes. config-sync stops pushing and only records which hash each tenant should run.

## Rollout

Planned for Q1 next year, behind a per-tenant flag. Not started.
