import { ProjectMemory, GraphNode } from "./project_memory.js";
import { TaskCapsuleManager, TaskCapsuleRecord } from "../tasks/task_capsule.js";
import { DecisionLedger, DecisionRecord } from "../decisions/decision_ledger.js";
import { ProvenanceEngine, EvidenceRecord } from "./provenance_engine.js";

export interface ContextPackage {
  projectId: string;
  taskId: string | null;
  userInstruction: string;
  activeCapsule: TaskCapsuleRecord | null;
  applicableRules: string[];
  acceptedDecisions: DecisionRecord[];
  verifiedFiles: string[];
  relevantMemoryNodes: GraphNode[];
  recentEvidence: EvidenceRecord[];
  detectedContradictions: string[];
  estimatedTokens: number;
  whyThisContext: Record<string, { relevanceReason: string; verified: boolean; source: string }>;
}

export class ContextBuilder {
  private memory: ProjectMemory;
  private capsuleManager: TaskCapsuleManager;
  private decisionLedger: DecisionLedger;
  private provenance: ProvenanceEngine;
  public readonly projectId: string;

  constructor(memory: ProjectMemory) {
    this.memory = memory;
    this.projectId = memory.projectId;
    this.capsuleManager = new TaskCapsuleManager(memory.getRawDb(), this.projectId);
    this.decisionLedger = new DecisionLedger(memory.getRawDb(), this.projectId);
    this.provenance = new ProvenanceEngine(memory.getRawDb(), this.projectId);
  }

  /**
   * Constructs a compact, prioritized, evidence-backed Context Package for an AI agent.
   */
  public buildContextPackage(params: {
    userInstruction: string;
    taskId?: string;
    maxNodes?: number;
    tokenBudget?: number;
  }): ContextPackage {
    const { userInstruction, taskId, maxNodes = 10, tokenBudget = 4000 } = params;
    const whyMap: Record<string, { relevanceReason: string; verified: boolean; source: string }> = {};

    // 1. Task Capsule
    let activeCapsule: TaskCapsuleRecord | null = null;
    if (taskId) {
      activeCapsule = this.capsuleManager.getCapsule(taskId);
      if (activeCapsule) {
        whyMap[`task:${taskId}`] = {
          relevanceReason: "Active task context capsule defining authorized scope and boundaries",
          verified: true,
          source: `task_context_capsules table [${taskId}]`
        };
      }
    }

    // 2. Applicable Rules & Constraints
    const applicableRules: string[] = [
      "Zero Touch on external repositories unless explicitly authorized.",
      "Never modify out-of-scope files.",
      "Verify source file existence and hash before claiming implementation facts."
    ];
    if (activeCapsule) {
      applicableRules.push(...activeCapsule.constraints);
    }

    // 3. Accepted Decisions
    const allDecisions = this.decisionLedger.listDecisions({ status: "ACCEPTED" });
    const acceptedDecisions: DecisionRecord[] = [];
    for (const d of allDecisions) {
      acceptedDecisions.push(d);
      whyMap[`decision:${d.id}`] = {
        relevanceReason: `Mandatory accepted architectural decision: ${d.title}`,
        verified: Boolean(d.approved_by),
        source: `decisions table [${d.id}]`
      };
    }

    // 4. Contradiction Detection against user instruction
    const conflicts = this.decisionLedger.detectContradictions(userInstruction);
    const detectedContradictions = conflicts.map(c => c.reason);

    // 5. Relevant Memory Nodes via FTS5
    const memoryNodes = this.memory.searchFts(userInstruction, maxNodes);
    for (const n of memoryNodes) {
      const nodeEvidence = this.provenance.getEvidenceForNode(n.id);
      const isVerified = nodeEvidence.some(e => e.status === "VERIFIED");
      whyMap[`node:${n.id}`] = {
        relevanceReason: `FTS5 matched query '${userInstruction.slice(0, 30)}...' against name/summary`,
        verified: isVerified,
        source: n.file_path || "virtual entity"
      };
    }

    // 6. In-Scope / Verified Files
    const verifiedFiles: string[] = [];
    if (activeCapsule && activeCapsule.in_scope_paths.length > 0) {
      verifiedFiles.push(...activeCapsule.in_scope_paths);
    } else {
      for (const n of memoryNodes) {
        if (n.file_path && !verifiedFiles.includes(n.file_path)) {
          verifiedFiles.push(n.file_path);
        }
      }
    }

    // 7. Recent Evidence
    const recentEvidence = this.provenance.listStaleMemories();

    // Rough token estimator (~4 chars per token)
    const rawText = JSON.stringify({
      userInstruction,
      activeCapsule,
      applicableRules,
      acceptedDecisions,
      verifiedFiles,
      memoryNodes
    });
    const estimatedTokens = Math.ceil(rawText.length / 4);

    return {
      projectId: this.projectId,
      taskId: taskId || null,
      userInstruction,
      activeCapsule,
      applicableRules,
      acceptedDecisions,
      verifiedFiles,
      relevantMemoryNodes: memoryNodes,
      recentEvidence,
      detectedContradictions,
      estimatedTokens,
      whyThisContext: whyMap
    };
  }

  /**
   * Generates formatted Markdown summary of why each context piece was included.
   */
  public explainContext(pkg: ContextPackage): string {
    const lines: string[] = [
      `# Context Package Inspector: Project [${pkg.projectId}]`,
      `- **Active Task:** ${pkg.taskId || "None (General Session)"}`,
      `- **Estimated Tokens:** ~${pkg.estimatedTokens}`,
      `- **Known Contradictions:** ${pkg.detectedContradictions.length > 0 ? "⚠️ CONFLICTS DETECTED" : "None"}`,
      ""
    ];

    if (pkg.detectedContradictions.length > 0) {
      lines.push("### ⚠️ Contradiction Warnings");
      for (const c of pkg.detectedContradictions) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }

    lines.push("### Why This Context? (Provenance Ledger)");
    for (const [key, why] of Object.entries(pkg.whyThisContext)) {
      const statusIcon = why.verified ? "✅ VERIFIED" : "⚠️ UNVERIFIED";
      lines.push(`- **[${key}]** (${statusIcon})`);
      lines.push(`  - Reason: ${why.relevanceReason}`);
      lines.push(`  - Source: \`${why.source}\``);
    }

    return lines.join("\n");
  }
}
