import type { AgentEvent, AgentRunRequest } from '../../../packages/protocol/src/agent';
import type { AdapterEvent, AdapterReviewResult, AgentAdapter, AgentRunContext, RestoredAdapterRun } from './agentGateway';
import { mcpCapabilityRegistry } from './mcpCapabilityRegistry';
import { nodeSupervisorGateway } from './nodeSupervisorGateway';
import { skillRegistry } from './skillRegistry';
import { workspaceBindingRegistry } from './workspaceBindingRegistry';

const MAX_SUPERVISOR_SKILL_BYTES = 300_000;

export class SupervisedAgentAdapter implements AgentAdapter {
  readonly name: string;

  constructor(private readonly worker: AgentAdapter) {
    this.name = `langgraph+${worker.name}`;
  }

  async *run(input: AgentRunRequest, signal: AbortSignal, context: AgentRunContext): AsyncIterable<AdapterEvent> {
    yield { type: 'tool_started', payload: { tool: 'langgraph-node-supervisor', message: 'Preparing Skills, MCP capabilities, and an execution brief.' } };
    const binding = await workspaceBindingRegistry.resolve(input.workspaceId);
    const [activatedSkills, mcpCatalog] = await Promise.all([
      skillRegistry.activate(input.workspaceId, input.prompt, 'node-agent'),
      mcpCapabilityRegistry.list(input.workspaceId),
    ]);
    const skillBlock = activatedSkills.map((skill) => `\n## Skill: ${skill.name} (${skill.source})\n${skill.content}`).join('\n');
    if (Buffer.byteLength(skillBlock, 'utf8') > MAX_SUPERVISOR_SKILL_BYTES) {
      throw new Error('Activated Skills exceed the 300KB node-agent context budget. Disable unrelated Skills or reduce their references.');
    }

    let brief: string;
    let mcpCalls: Array<{ serverId: string; tool: string; status: string }> = [];
    let supervisorFallback = false;
    try {
      const result = await nodeSupervisorGateway.prepare({
        runId: context.runId,
        request: input,
        workspaceRoot: binding.sourceRoot,
        activatedSkills,
        mcpCatalog,
      }, signal);
      brief = result.brief;
      mcpCalls = result.mcpCalls;
    } catch (error) {
      supervisorFallback = true;
      brief = [
        'LangGraph supervisor was unavailable; use this deterministic execution brief.',
        `Objective: ${input.prompt}`,
        'Inspect the repository before changing files. Work only in the isolated managed copy.',
        'Run relevant tests and report evidence. Return all changes through MeshCLI Diff review.',
      ].join('\n');
      yield {
        type: 'command_output',
        payload: { stream: 'system', text: `LangGraph supervisor fallback: ${error instanceof Error ? error.message : String(error)}` },
      };
    }
    yield {
      type: 'tool_finished',
      payload: {
        tool: 'langgraph-node-supervisor',
        activatedSkills: activatedSkills.map((skill) => ({ name: skill.name, source: skill.source })),
        mcpServers: mcpCatalog.filter((server) => server.enabled).map((server) => server.id),
        mcpCalls,
        fallback: supervisorFallback,
      },
    };
    yield {
      type: 'plan_updated',
      payload: {
        plan: [
          { id: 'supervisor', title: 'Prepare LangGraph execution brief', status: 'completed' },
          { id: 'inspect', title: 'Inspect repository evidence', status: 'in_progress' },
          { id: 'execute', title: 'Execute changes in isolated OpenHands workspace', status: 'pending' },
          { id: 'review', title: 'Review Diff before applying', status: 'pending' },
        ],
      },
    };

    const supervised: AgentRunRequest = {
      ...input,
      prompt: [
        input.prompt,
        '\n--- MeshCLI LangGraph Supervisor Brief ---',
        brief,
        '\n--- Activated Skill Instructions ---',
        skillBlock || 'No Skill was activated for this task.',
        '\n--- End Supervisor Context ---',
      ].join('\n'),
    };
    for await (const event of this.worker.run(supervised, signal, context)) yield event;
  }

  apply(runId: string): Promise<AdapterReviewResult> {
    if (!this.worker.apply) throw new Error('Execution worker does not support apply.');
    return this.worker.apply(runId);
  }

  undo(runId: string): Promise<AdapterReviewResult> {
    if (!this.worker.undo) throw new Error('Execution worker does not support undo.');
    return this.worker.undo(runId);
  }

  reject(runId: string): Promise<AdapterReviewResult> {
    if (!this.worker.reject) throw new Error('Execution worker does not support reject.');
    return this.worker.reject(runId);
  }

  cancel(runId: string): Promise<void> { return this.worker.cancel?.(runId) ?? Promise.resolve(); }
  fail(runId: string): Promise<void> { return this.worker.fail?.(runId) ?? Promise.resolve(); }
  restoreRun(runId: string): Promise<RestoredAdapterRun | undefined> { return this.worker.restoreRun?.(runId) ?? Promise.resolve(undefined); }
  persistEvent(runId: string, event: AgentEvent): Promise<void> { return this.worker.persistEvent?.(runId, event) ?? Promise.resolve(); }
}
